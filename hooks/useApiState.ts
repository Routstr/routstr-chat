import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ModelManager, MintDiscovery } from "@routstr/sdk";
import { Model } from "@/types/models";
import {
  loadBaseUrl,
  saveBaseUrl,
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
  isOnionUrl,
  isTorContext,
  normalizeProviderUrl,
} from "@/utils/torUtils";
import { useDiscoveryAdapter } from "./useDiscoveryAdapter";

export interface UseApiStateReturn {
  models: Model[];
  selectedModel: Model | null;
  isLoadingModels: boolean;
  isRefreshingModels: boolean;
  baseUrl: string;
  setSelectedModel: (model: Model | null) => void;
  setBaseUrl: (url: string) => void;
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
  const modelManager = useMemo(
    () => (discoveryAdapter ? new ModelManager(discoveryAdapter) : null),
    [discoveryAdapter]
  );
  const mintDiscovery = useMemo(
    () => (discoveryAdapter ? new MintDiscovery(discoveryAdapter) : null),
    [discoveryAdapter]
  );

  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [baseUrl, setBaseUrlState] = useState("");
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

    const currentBaseUrl = loadBaseUrl("");
    if (!torMode && currentBaseUrl && isOnionUrl(currentBaseUrl)) {
      const fallbackBaseUrl = filteredBaseUrls[0] || "";
      setBaseUrlState(fallbackBaseUrl);
      saveBaseUrl(fallbackBaseUrl);
    } else {
      setBaseUrlState(currentBaseUrl);
    }
  }, [isAuthenticated]);

  const fetchModels = useCallback(
    async (_balance?: number) => {
      if (!modelManager || !mintDiscovery || !discoveryAdapter) return;

      try {
        setIsLoadingModels(true);
        setIsRefreshingModels(true);
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
            setIsRefreshingModels(false);
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
          const mappedBase = loadModelProviderMap()[modelToSelect.id];
          if (mappedBase) {
            const normalized = mappedBase.endsWith("/")
              ? mappedBase
              : `${mappedBase}/`;
            setBaseUrl(normalized);
          }
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
    if (!isAuthenticated || !modelManager || !mintDiscovery) return;
    void fetchModels(balance);
  }, [isAuthenticated, modelManager, mintDiscovery, baseUrlsList.length]);

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
          setBaseUrl(normalized);
          return;
        }
      }

      const model = models.find((m: Model) => m.id === modelId);
      if (!model) return;
      setSelectedModel(model);
      saveLastUsedModel(modelId);
      const mappedBase = loadModelProviderMap()[modelId];
      if (mappedBase) {
        const normalized = mappedBase.endsWith("/")
          ? mappedBase
          : `${mappedBase}/`;
        setBaseUrl(normalized);
      }
    },
    [models]
  );

  const setBaseUrl = useCallback((url: string) => {
    const torMode = isTorContext();
    const normalizedUrl = normalizeProviderUrl(url, torMode) || "";
    if (!torMode && normalizedUrl && isOnionUrl(normalizedUrl)) {
      return;
    }
    setBaseUrlState(normalizedUrl);
    saveBaseUrl(normalizedUrl);
    const updatedBaseUrlsList = filterBaseUrlsForTor(
      loadBaseUrlsList(),
      torMode
    );
    setBaseUrlsList(updatedBaseUrlsList);
  }, []);

  return {
    models,
    selectedModel,
    isLoadingModels,
    isRefreshingModels,
    baseUrl,
    setSelectedModel,
    setBaseUrl,
    fetchModels,
    handleModelChange,
    lowBalanceWarningForModel,
  };
};
