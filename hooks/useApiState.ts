import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { MintDiscovery } from "@routstr/sdk";
import { Model } from "@/types/models";
import {
  loadLastUsedModel,
  saveLastUsedModel,
  loadBaseUrlsList,
  saveBaseUrlsList,
  loadModelProviderMap,
  saveModelProviderMap,
} from "@/utils/storageUtils";
import {
  parseModelKey,
  normalizeBaseUrl,
  modelSelectionStrategy,
  isModelAvailable,
  getAllProviderModels,
} from "@/utils/modelUtils";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import { useNodePays } from "@/hooks/useRemoteNode";
import {
  filterBaseUrlsForTor,
  isTorContext,
} from "@/utils/torUtils";
import { useDiscoveryAdapter } from "./useDiscoveryAdapter";
import { hydrate, modelManager, providerManager } from "@/sdk/sharedStore";

export interface UseApiStateReturn {
  models: Model[];
  selectedModel: Model | null;
  isLoadingModels: boolean;
  /** The first full model load, and the pick that ends it, have finished. */
  hasPickedModel: boolean;
  setSelectedModel: (model: Model | null) => void;
  fetchModels: (balance: number) => Promise<void>;
  handleModelChange: (modelId: string, configuredKeyOverride?: string) => void;
  lowBalanceWarningForModel: boolean;
}

export const useApiState = (
  isAuthenticated: boolean,
  balance: number,
  maxBalance: number,
  pendingCashuAmountState: number,
  isWalletLoading: boolean
): UseApiStateReturn => {
  const searchParams = useSearchParams();
  const discoveryAdapter = useDiscoveryAdapter();
  // modelManager is a shared singleton from @/sdk/sharedStore — no need to
  // create one per-hook.  This ensures useChatActions and useApiState share
  // the same bootstrap state, cache reads, and provider metadata.
  const mintDiscovery = useMemo(
    () => (discoveryAdapter ? new MintDiscovery(discoveryAdapter) : null),
    [discoveryAdapter]
  );

  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [hasPickedModel, setHasPickedModel] = useState(false);
  const [baseUrlsList, setBaseUrlsList] = useState<string[]>([]);
  const [lowBalanceWarningForModel, setLowBalanceWarningForModel] =
    useState(false);
  const nodePays = useNodePays();
  // Passes are queued and can run long after they were scheduled, so read the
  // mode when a pass actually runs. Otherwise a slow first-run public pass
  // finishes after the node is connected and overwrites it.
  const nodePaysRef = useRef(nodePays);
  nodePaysRef.current = nodePays;

  // Seed models from the last fetch so the selector opens instantly while the
  // real fetch refreshes them in the background (stale-while-revalidate).
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    // The SDK cache lives in IndexedDB; wait for hydrate or the seed reads an
    // empty store and only the legacy localStorage copy would be visible.
    hydrate.then(() => {
      if (cancelled) return;
      const torMode = isTorContext();
      const cached = getAllProviderModels();
      const byId = new Map<string, Model>();
      for (const providerModels of Object.values(cached)) {
        for (const model of providerModels) {
          if (byId.has(model.id)) continue;
          // Skip models with no routable provider (onion outside Tor, disabled,
          // on cooldown) or they show as "loaded" but every ranking is empty.
          if (!providerManager.getBestProviderForModel(model.id, { torMode })) {
            continue;
          }
          byId.set(model.id, model);
        }
      }
      // Nothing eligible: stay loading and let the real fetch decide
      if (byId.size === 0) return;
      setModels((current) =>
        current.length > 0 ? current : Array.from(byId.values())
      );
      setIsLoadingModels(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const torMode = isTorContext();
    const loadedBaseUrls = loadBaseUrlsList();
    const filteredBaseUrls = filterBaseUrlsForTor(loadedBaseUrls, torMode);
    if (filteredBaseUrls.length !== loadedBaseUrls.length) {
      saveBaseUrlsList(filteredBaseUrls);
    }
    setBaseUrlsList(filteredBaseUrls);
  }, [isAuthenticated]);

  const fetchModels = useCallback(
    async (_balance?: number) => {
      if (!modelManager || !mintDiscovery || !discoveryAdapter) return;

      try {
        setIsLoadingModels(true);
        const torMode = isTorContext();
        const node = nodePaysRef.current;
        let bases = baseUrlsList;

        if (node) {
          // Node mode swaps the provider set rather than adding to it: the SDK
          // prunes every provider outside this list, so the node ends up the
          // only one it can route to or fall back to.
          bases = [node.url];
        } else if (!bases || bases.length === 0) {
          bases = await modelManager.bootstrapProviders(torMode, false);
          if (process.env.NODE_ENV === "development") {
            const localDevProvider = "http://localhost:8000/";
            if (!bases.includes(localDevProvider)) {
              const withDev = [...bases, localDevProvider];
              discoveryAdapter.setBaseUrlsList(withDev);
              discoveryAdapter.setBaseUrlsLastUpdate(Date.now());
              bases = withDev;
            }
          }
          bases = filterBaseUrlsForTor(bases, torMode);
          setBaseUrlsList(bases);
          saveBaseUrlsList(bases);
          if (bases.length === 0) {
            setModels([]);
            setSelectedModel(null);
            setIsLoadingModels(false);
            return;
          }
        }

        let firstProgress = true;

        // The prune drops the other mode's lists but leaves their timestamps
        // fresh, so without this the picker comes back empty after a toggle.
        const cached = discoveryAdapter.getCachedModels();
        const staleSet = !bases.some((base) => cached[base]?.length);

        const onFetchProgress = (progressModels: unknown[]) => {
          // Ignore empty ticks entirely: they would blank a populated list, and
          // an empty first tick would flip off loading with nothing to show.
          if (progressModels.length === 0) return;
          if (firstProgress) {
            setIsLoadingModels(false);
            firstProgress = false;
          }
          setModels(progressModels as unknown as Model[]);
        };

        let combinedModels = (await modelManager.fetchModels(
          bases,
          staleSet,
          onFetchProgress
        )) as unknown as Model[];

        // Zero models across every provider means the cache is poisoned:
        // per-provider freshness timestamps survived a session where the
        // model payload write was lost, so each pass serves empty "valid"
        // cache entries and re-stamps them, never refetching. Force one
        // network refresh to repopulate and break the loop.
        if (combinedModels.length === 0 && bases.length > 0) {
          combinedModels = (await modelManager.fetchModels(
            bases,
            true,
            onFetchProgress
          )) as unknown as Model[];
        }

        // Delegate cheapest-provider selection to the SDK's
        // ProviderManager.getBestProviderForModel so the persisted
        // model_provider_map matches the ranking used by the ModelSelector
        // details panel (prompt + completion total) and respects disabled /
        // on-cooldown providers — keeping the list view consistent with actual
        // routing decisions.
        const bestMap = loadModelProviderMap();
        let mapChanged = false;
        for (const model of combinedModels) {
          const bestBase = providerManager.getBestProviderForModel(model.id, {
            torMode,
          });
          if (bestBase && bestMap[model.id] !== bestBase) {
            bestMap[model.id] = bestBase;
            mapChanged = true;
          }
        }
        if (mapChanged) {
          saveModelProviderMap(bestMap);
          // The selector re-reads the provider map when the models array
          // identity changes; the last progress tick fired before the map
          // was saved, so nudge it once more or cold loads show every
          // provider as Unknown until a manual refresh.
          setModels((current) => [...current]);
        }

        await mintDiscovery.discoverMints(bases);

        let modelToSelect: Model | null = null;
        const urlModelId = searchParams.get("model");
        if (urlModelId) {
          const decodedUrlModelId = decodeURIComponent(urlModelId).trim();
          const shortUrlModelId =
            decodedUrlModelId.split("/").pop() || decodedUrlModelId;
          modelToSelect =
            combinedModels.find(
              (m: Model) =>
                m.id === decodedUrlModelId || m.id === shortUrlModelId
            ) || null;
        }

        const lastUsedModelId = loadLastUsedModel();
        if (!modelToSelect) {
          modelToSelect = await modelSelectionStrategy(
            combinedModels,
            maxBalance,
            pendingCashuAmountState
          );
        }

        setSelectedModel(modelToSelect);
        if (
          modelToSelect &&
          lastUsedModelId &&
          !lastUsedModelId.includes("@@")
        ) {
          saveLastUsedModel(modelToSelect.id);
        }
      } catch (error) {
        console.error("Error while fetching models", error);
        setModels([]);
        setSelectedModel(null);
      } finally {
        setIsLoadingModels(false);
        setHasPickedModel(true);
      }
    },
    [
      modelManager,
      mintDiscovery,
      discoveryAdapter,
      baseUrlsList,
      searchParams,
      maxBalance,
      pendingCashuAmountState,
    ]
  );

  // Each pass overwrites the shared cache wholesale, so serialise them and let
  // the newest win. `hydrated` holds the first pass until useNodePays knows
  // which mode we are in.
  const passRef = useRef(0);
  const passChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!isAuthenticated || !mintDiscovery || !hydrated) return;
    const pass = ++passRef.current;
    passChainRef.current = passChainRef.current.then(() =>
      pass === passRef.current ? fetchModels(balance) : undefined
    );
  }, [isAuthenticated, mintDiscovery, baseUrlsList.length, nodePays, hydrated]);

  // -----------------------------------------------------------------------
  // Background cache refresh
  // -----------------------------------------------------------------------
  // Periodically refresh the provider/model cache so that fetchAIResponse
  // (called from useChatActions) never blocks on a stale cache.  The refresh
  // uses forceRefresh = false, so it only hits the network when the 210-min
  // TTL has expired — the interval just needs to be frequent enough to catch
  // staleness.  This runs as a fire-and-forget side-effect: it never blocks
  // the UI or message sending.
  const refreshInProgress = useRef(false);
  useEffect(() => {
    // One provider, and this pass would prune it.
    if (!isAuthenticated || !mintDiscovery || nodePays) return;

    const backgroundRefresh = async () => {
      if (refreshInProgress.current) return;
      // Re-check at run time: a node connected while this waited in the chain,
      // and this pass would prune it from the cache.
      if (nodePaysRef.current) return;
      refreshInProgress.current = true;
      try {
        const torMode = isTorContext();
        let bases = modelManager.getBaseUrls();
        if (bases.length === 0) return; // nothing to refresh yet
        bases = await modelManager.bootstrapProviders(torMode, false);
        if (bases.length === 0) return;
        await modelManager.fetchModels(bases, false);
        await mintDiscovery.discoverMints(bases);
      } catch (e) {
        console.warn("Background model refresh failed:", e);
      } finally {
        refreshInProgress.current = false;
      }
    };

    // The SDK stamps a provider fresh the moment its fetch settles but writes
    // model payloads only at end-of-pass, so a refresh overlapping another
    // pass reads "valid" empty entries and later clobbers the cache with
    // them. Queue refreshes on the pass chain so they never overlap.
    const queueRefresh = () => {
      passChainRef.current = passChainRef.current.then(backgroundRefresh);
    };

    // Run shortly after mount (gives the initial fetchModels a head start)
    const initialTimer = setTimeout(queueRefresh, 10_000);
    // Then every 30 minutes — will only do network work when cache is stale
    const interval = setInterval(queueRefresh, 30 * 60 * 1000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isAuthenticated, mintDiscovery, nodePays]);

  useEffect(() => {
    if (!isAuthenticated || models.length === 0) return;

    const selectModel = async () => {
      if (!selectedModel && !isWalletLoading) {
        const lastUsedModel = loadLastUsedModel();
        const model = await modelSelectionStrategy(
          models,
          maxBalance,
          pendingCashuAmountState
        );
        if (model && lastUsedModel && lastUsedModel === model.id) {
          handleModelChange(model.id);
        } else if (model && !lastUsedModel) {
          handleModelChange(model.id);
        }
      }

      if (selectedModel && !isWalletLoading) {
        setLowBalanceWarningForModel(
          !nodePays &&
            !isModelAvailable(
              selectedModel,
              balance + getPendingCashuTokenAmount()
            )
        );
      }
    };

    void selectModel();
  }, [
    balance,
    models,
    isAuthenticated,
    selectedModel,
    isLoadingModels,
    pendingCashuAmountState,
    isWalletLoading,
    maxBalance,
    nodePays,
  ]);

  const handleModelChange = useCallback(
    (modelId: string, configuredKeyOverride?: string) => {
      if (configuredKeyOverride && configuredKeyOverride.includes("@@")) {
        const parsed = parseModelKey(configuredKeyOverride);
        const fixedBaseRaw = parsed.base;
        const fixedBase = normalizeBaseUrl(fixedBaseRaw);
        if (!fixedBase) return;

        const normalized = fixedBase.endsWith("/")
          ? fixedBase
          : `${fixedBase}/`;
        const allByProvider = getAllProviderModels();
        const list =
          allByProvider?.[normalized] ||
          allByProvider?.[configuredKeyOverride] ||
          [];
        const providerSpecific = Array.isArray(list)
          ? list.find((m: Model) => m.id === parsed.id)
          : undefined;
        if (providerSpecific) {
          setSelectedModel(providerSpecific);
          saveLastUsedModel(configuredKeyOverride);
          return;
        }
      }

      const model = models.find((m: Model) => m.id === modelId);
      if (!model) return;
      setSelectedModel(model);
      saveLastUsedModel(modelId);
    },
    [models]
  );

  return {
    models,
    selectedModel,
    isLoadingModels,
    hasPickedModel,
    setSelectedModel,
    fetchModels,
    handleModelChange,
    lowBalanceWarningForModel,
  };
};
