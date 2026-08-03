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
  getStorageItem,
} from "@/utils/storageUtils";
import {
  parseModelKey,
  normalizeBaseUrl,
  modelSelectionStrategy,
  isModelAvailable,
} from "@/utils/modelUtils";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import { useNodePays } from "@/hooks/useRemoteNode";
import {
  filterBaseUrlsForTor,
  isTorContext,
} from "@/utils/torUtils";
import { useDiscoveryAdapter } from "./useDiscoveryAdapter";
import { modelManager, providerManager } from "@/sdk/sharedStore";

export interface UseApiStateReturn {
  models: Model[];
  selectedModel: Model | null;
  isLoadingModels: boolean;
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
  const [baseUrlsList, setBaseUrlsList] = useState<string[]>([]);
  const [lowBalanceWarningForModel, setLowBalanceWarningForModel] =
    useState(false);
  const nodePays = useNodePays();
  // Passes are queued and can run long after they were scheduled, so read the
  // mode when a pass actually runs. Otherwise a slow first-run public pass
  // finishes after the node is connected and overwrites it.
  const nodePaysRef = useRef(nodePays);
  nodePaysRef.current = nodePays;

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

        // routstrd needs a JSON body with a model field, so it cannot proxy
        // Tinfoil's encrypted transport.
        const visible = (list: Model[]) =>
          node ? list.filter((m) => !m.id.startsWith("tinfoil-")) : list;

        const combinedModels = visible(
          (await modelManager.fetchModels(
            bases,
            staleSet,
            (progressModels) => {
              if (firstProgress) {
                setIsLoadingModels(false);
                firstProgress = false;
              }
              setModels(visible(progressModels as unknown as Model[]));
            }
          )) as unknown as Model[]
        );

        // Delegate cheapest-provider selection to the SDK's
        // ProviderManager.getBestProviderForModel so the persisted
        // model_provider_map matches the ranking used by the ModelSelector
        // details panel (prompt + completion total) and respects disabled /
        // on-cooldown providers — keeping the list view consistent with actual
        // routing decisions.
        const bestMap = loadModelProviderMap();
        let mapChanged = false;
        for (const model of combinedModels) {
          const bestBase = providerManager.getBestProviderForModel(model.id);
          if (bestBase && bestMap[model.id] !== bestBase) {
            bestMap[model.id] = bestBase;
            mapChanged = true;
          }
        }
        if (mapChanged) saveModelProviderMap(bestMap);

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
        const allByProvider = getStorageItem<Record<string, Model[]>>(
          "modelsFromAllProviders",
          {}
        );
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
    setSelectedModel,
    fetchModels,
    handleModelChange,
    lowBalanceWarningForModel,
  };
};
