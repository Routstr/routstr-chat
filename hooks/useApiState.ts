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
import {
  filterBaseUrlsForTor,
  isTorContext,
} from "@/utils/torUtils";
import { useDiscoveryAdapter } from "./useDiscoveryAdapter";
import { modelManager } from "@/sdk/sharedStore";

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
        let bases = baseUrlsList;

        if (!bases || bases.length === 0) {
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

        const combinedModels = (await modelManager.fetchModels(
          bases,
          false,
          (progressModels) => {
            if (firstProgress) {
              setIsLoadingModels(false);
              firstProgress = false;
            }
            setModels(progressModels as unknown as Model[]);
          }
        )) as unknown as Model[];

        const allProviderModels = modelManager.getAllCachedModels();
        const bestMap = loadModelProviderMap();
        let mapChanged = false;
        for (const model of combinedModels) {
          let bestBase: string | null = null;
          let bestCost = Number.POSITIVE_INFINITY;

          for (const [providerBase, providerModels] of Object.entries(
            allProviderModels
          )) {
            const match = providerModels.find((m) => m.id === model.id);
            if (!match?.sats_pricing) continue;
            const cost = match.sats_pricing.completion ?? 0;
            if (cost < bestCost) {
              bestCost = cost;
              bestBase = providerBase;
            }
          }

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

  useEffect(() => {
    if (!isAuthenticated || !mintDiscovery) return;
    void fetchModels(balance);
  }, [isAuthenticated, mintDiscovery, baseUrlsList.length]);

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
    if (!isAuthenticated || !mintDiscovery) return;

    const backgroundRefresh = async () => {
      if (refreshInProgress.current) return;
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

    // Run shortly after mount (gives the initial fetchModels a head start)
    const initialTimer = setTimeout(backgroundRefresh, 10_000);
    // Then every 30 minutes — will only do network work when cache is stale
    const interval = setInterval(backgroundRefresh, 30 * 60 * 1000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isAuthenticated, mintDiscovery]);

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
