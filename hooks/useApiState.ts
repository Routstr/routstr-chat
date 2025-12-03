import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Model } from '@/data/models';
import { loadBaseUrl, saveBaseUrl, loadLastUsedModel, saveLastUsedModel, loadBaseUrlsList, saveBaseUrlsList, migrateCurrentCashuToken, loadModelProviderMap, saveModelProviderMap, setStorageItem, getStorageItem, loadDisabledProviders, saveMintsFromAllProviders, setProviderLastUpdate, getProviderLastUpdate, saveInfoFromAllProviders } from '@/utils/storageUtils';
import {parseModelKey, normalizeBaseUrl, upsertCachedProviderModels, isModelAvailable, getRequiredSatsForModel, modelSelectionStrategy } from '@/utils/modelUtils';
import { getPendingCashuTokenAmount, getPendingCashuTokenDistribution } from '@/utils/cashuUtils';
import { recommendedModels } from '@/lib/recommendedModels';

export interface UseApiStateReturn {
  models: Model[];
  selectedModel: Model | null;
  isLoadingModels: boolean;
  baseUrl: string;
  setSelectedModel: (model: Model | null) => void;
  setBaseUrl: (url: string) => void;
  fetchModels: (balance: number) => Promise<void>; // Modified to accept balance
  handleModelChange: (modelId: string, configuredKeyOverride?: string) => void;
  lowBalanceWarningForModel: boolean;
}

/**
 * Custom hook for managing API configuration and model state
 * Handles API endpoint configuration, model fetching and caching,
 * model selection state, and API error handling
 */
export const useApiState = (isAuthenticated: boolean, balance: number, maxBalance: number, pendingCashuAmountState: number, isWalletLoading: boolean): UseApiStateReturn => {
  const searchParams = useSearchParams();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [baseUrl, setBaseUrlState] = useState('');
  const [baseUrlsList, setBaseUrlsList] = useState<string[]>([]);
  const [lowBalanceWarningForModel, setLowBalanceWarningForModel] = useState(false);
  // Removed unused currentBaseUrlIndex state

  // Initialize URLs from storage
  useEffect(() => {
    if (isAuthenticated) {
      const loadedBaseUrls = loadBaseUrlsList();
      setBaseUrlsList(loadedBaseUrls);

      const currentBaseUrl = loadBaseUrl('');
      setBaseUrlState(currentBaseUrl);
    }
  }, [isAuthenticated]);

  // Helper: normalize a provider base URL
  const normalizeBase = useCallback((url: string | undefined | null): string | null => {
    if (!url || typeof url !== 'string' || url.length === 0) return null;
    const withProto = url.startsWith('http') ? url : `https://${url}`;
    return withProto.endsWith('/') ? withProto : `${withProto}/`;
  }, []);

  // Bootstrap provider bases from the directory when none are configured
  const bootstrapProviders = useCallback(async (): Promise<string[]> => {
    try {
      const res = await fetch('https://api.routstr.com/v1/providers/');
      if (!res.ok) throw new Error(`Failed providers ${res.status}`);
      const data = await res.json();
      const providers = Array.isArray(data?.providers) ? data.providers : [];
      const bases = new Set<string>();
      for (const p of providers) {
        const primary = normalizeBase(p?.endpoint_url);
        if (primary && !primary.startsWith('http://')) bases.add(primary);
        const alts: string[] = Array.isArray(p?.endpoint_urls) ? p.endpoint_urls : [];
        for (const alt of alts) {
          const n = normalizeBase(alt);
          if (n && !n.startsWith('http://')) bases.add(n);
        }
      }
      // Filter out disabled providers and staging providers on production
      const disabledProviders = loadDisabledProviders();
      const isProduction = typeof window !== 'undefined' && 
        window.location.hostname === 'chat.routstr.com';
      const list = Array.from(bases).filter(base => {
        const normalized = base.endsWith('/') ? base : `${base}/`;
        // Filter out disabled providers
        if (disabledProviders.includes(normalized)) return false;
        // Filter out staging providers on production
        if (isProduction && base.includes('staging')) return false;
        return true;
      });
      if (list.length > 0) {
        saveBaseUrlsList(list);
        setBaseUrlsList(list);
      }
      return list;
    } catch (e) {
      console.error('Failed to bootstrap providers', e);
      return [];
    }
  }, [normalizeBase]);

  // Migrate old cashu token format on load
  useEffect(() => {
    if (baseUrl) {
      migrateCurrentCashuToken(baseUrl);
    }
  }, [baseUrl]);

  // Fetch available models from API and handle URL model selection
  const fetchModels = useCallback(async () => {
    try {
      setIsLoadingModels(true);
      let bases = baseUrlsList;
      if (!bases || bases.length === 0) {
        bases = await bootstrapProviders();
        if (!bases || bases.length === 0) {
          setModels([]);
          setSelectedModel(null);
          return;
        }
      }

      // Filter out disabled providers
      const disabledProviders = loadDisabledProviders();
      bases = bases.filter(base => {
        const normalized = base.endsWith('/') ? base : `${base}/`;
        return !disabledProviders.includes(normalized);
      });

      // Process results progressively as each provider responds
      const modelsFromAllProviders: Record<string, Model[]> = {};
      const bestById = new Map<string, { model: Model; base: string }>();
      let processedCount = 0;
      const totalProviders = bases.length;

      function estimateMinCost(m: Model): number {
        return m?.sats_pricing?.completion ?? 0;
      }

      // Helper to update best models and UI state
      const updateBestModels = () => {
        const combinedModels = Array.from(bestById.values()).map(v => v.model);
        setModels(combinedModels);

        // Persist provider mapping for best-priced winners
        const newMap = loadModelProviderMap();
        let changed = false;
        for (const [id, entry] of bestById.entries()) {
          if (newMap[id] !== entry.base) {
            newMap[id] = entry.base;
            changed = true;
          }
        }
        if (changed) saveModelProviderMap(newMap);

        return combinedModels;
      };

      // Process each provider as it responds
      const fetchPromises = bases.map(async (url) => {
        const base = url.endsWith('/') ? url : `${url}/`;
        try {
          // Check if we need to fetch or can use cached data
          const lastUpdate = getProviderLastUpdate(base);
          const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds
          const shouldFetch = !lastUpdate || (Date.now() - lastUpdate) > ONE_HOUR;
          
          let list: Model[];
          
          if (shouldFetch) {
            // Fetch fresh data from provider
            const res = await fetch(`${base}v1/models`);
            if (!res.ok) throw new Error(`Failed ${res.status}`);
            const json = await res.json();
            list = Array.isArray(json?.data) ? json.data.map((m: Model) => ({
              ...m,
              id: m.id.split('/').pop() || m.id
            })) : [];
            
            // Save provider results
            modelsFromAllProviders[base] = list;
            
            // Update timestamp for this provider
            setProviderLastUpdate(base, Date.now());
          } else {
            // Load from storage (cached data is fresh enough)
            const cachedModels = getStorageItem<Record<string, Model[]>>('modelsFromAllProviders', {});
            list = cachedModels[base] || [];
            modelsFromAllProviders[base] = list;
          }
          
          // Update best-priced models
          for (const m of list) {
            const existing = bestById.get(m.id);
            if (!existing) {
              bestById.set(m.id, { model: m, base });
              continue;
            }
            const currentCost = estimateMinCost(m);
            const existingCost = estimateMinCost(existing.model);
            if (currentCost < existingCost) {
              bestById.set(m.id, { model: m, base });
            }
          }
          
          // Update UI with current best models
          processedCount++;
          updateBestModels();
          
          return { success: true, base, list };
        } catch (error) {
          processedCount++;
          console.warn(`Failed to fetch models from ${base}:`, error);
          return { success: false, base };
        }
      });

      // Wait for all to complete (but UI updates happen progressively)
      await Promise.allSettled(fetchPromises);

      // Save all provider results to localStorage
      try {
        setStorageItem('modelsFromAllProviders', modelsFromAllProviders);
      } catch {}

      // Final update to ensure we have the latest state
      const combinedModels = updateBestModels();

      // Select model based on URL param or last used
      let modelToSelect: Model | null = null;
      const urlModelId = searchParams.get('model');
      if (urlModelId) {
        modelToSelect = combinedModels.find((m: Model) => m.id === urlModelId) || null;
      }
      const lastUsedModelId = loadLastUsedModel();
      if (!modelToSelect) {
        modelToSelect = await modelSelectionStrategy(combinedModels, maxBalance, pendingCashuAmountState);
      }
      setSelectedModel(modelToSelect);
      if (modelToSelect && lastUsedModelId && !lastUsedModelId.includes('@@')) saveLastUsedModel(modelToSelect.id);
    } catch (error) {
      console.error('Error while fetching models', error);
      setModels([]);
      setSelectedModel(null);
    } finally {
      setIsLoadingModels(false);
    }
  }, [searchParams, baseUrlsList, bootstrapProviders]);

  // Fetch available mints from each provider's /v1/info endpoint
  const fetchMints = useCallback(async () => {
    try {
      let bases = baseUrlsList;
      if (!bases || bases.length === 0) {
        // If no providers yet, skip (will be called again after bootstrap)
        return;
      }

      // Store mints from all providers
      const infoFromAllProviders: Record<string, any> = {};
      const mintsFromAllProviders: Record<string, string[]> = {};

      // Fetch info from each provider
      const fetchPromises = bases.map(async (url) => {
        const base = url.endsWith('/') ? url : `${url}/`;
        try {
          const res = await fetch(`${base}v1/info`);
          if (!res.ok) throw new Error(`Failed ${res.status}`);
          const json = await res.json();
          
          // Extract mints array from response
          const mints: string[] = Array.isArray(json?.mints) ? json.mints : [];
          
          // Save provider mints
          mintsFromAllProviders[base] = mints;
          // Save full provider info
          infoFromAllProviders[base] = json;
          
          return { success: true, base, mints, info: json };
        } catch (error) {
          console.warn(`Failed to fetch mints from ${base}:`, error);
          return { success: false, base };
        }
      });

      // Wait for all to complete
      await Promise.allSettled(fetchPromises);

      // Save all provider mints and info to localStorage
      try {
        saveMintsFromAllProviders(mintsFromAllProviders);
      } catch (error) {
        console.error('Error saving mints to localStorage:', error);
      }
      try {
        saveInfoFromAllProviders(infoFromAllProviders);
      } catch (error) {
        console.error('Error saving provider info to localStorage:', error);
      }
    } catch (error) {
      console.error('Error while fetching mints', error);
    }
  }, [baseUrlsList]);

  // Fetch models and mints when providers are available and user is authenticated
  // Intentionally NOT dependent on balance to avoid reloading the selector on wallet updates
  useEffect(() => {
    if (!isAuthenticated) return;
    // Always attempt to fetch; will bootstrap providers if missing
    fetchModels();
    fetchMints();
  }, [isAuthenticated, baseUrlsList.length]);

  // Auto-select model based on balance when balance changes
  // Only auto-selects if no model is selected or current model is not available
  useEffect(() => {
    if (!isAuthenticated || models.length === 0) return;
    console.log('balance', balance);

    // Async function to handle model selection
    const selectModel = async () => {
      // Only auto-select if no model is selected or current model is not available
      if (!selectedModel && !isLoadingModels && !isWalletLoading) {
        const model = await modelSelectionStrategy(models, maxBalance, pendingCashuAmountState);
        if (model) {
          handleModelChange(model.id);
        }
      }
      if (selectedModel && !isWalletLoading) {
        setLowBalanceWarningForModel(!isModelAvailable(selectedModel, balance + getPendingCashuTokenAmount()));
      }
    };

    selectModel();
  }, [balance, models, isAuthenticated, selectedModel, isLoadingModels, pendingCashuAmountState]);

  const handleModelChange = useCallback((modelId: string, configuredKeyOverride?: string) => {
    console.log('rdlogs: handleModelChange', modelId, configuredKeyOverride);
    // If a provider base is explicitly provided, prefer provider-specific model from storage
    if (configuredKeyOverride && configuredKeyOverride.includes('@@')) {
      const parsed = parseModelKey(configuredKeyOverride!);
      const fixedBaseRaw = parsed.base;
      const fixedBase = normalizeBaseUrl(fixedBaseRaw);
      if (!fixedBase) return;
      try {
        const normalized = fixedBase.endsWith('/') ? fixedBase : `${fixedBase}/`;
        const allByProvider = getStorageItem<Record<string, Model[]>>('modelsFromAllProviders', {} as any);
        const list = allByProvider?.[normalized] || allByProvider?.[configuredKeyOverride] || [] as any;
        let providerSpecific = Array.isArray(list) ? list.find((m: Model) => m.id === parsed.id) : undefined;
        // If not found locally, fetch on-demand from provider and cache
        const ensureFetched = async (): Promise<Model | undefined> => {
          if (providerSpecific) return providerSpecific;
          try {
            const res = await fetch(`${normalized}v1/models`);
            if (!res.ok) throw new Error(`Failed ${res.status}`);
            const json = await res.json();
            const freshList: Model[] = Array.isArray(json?.data) ? json.data.map((m: Model) => ({
              ...m,
              id: m.id.split('/').pop() || m.id
            })) : [];
            // cache back to storage
            upsertCachedProviderModels(normalized, freshList);
            return freshList.find((m: Model) => m.id === parsed.id);
          } catch {
            return undefined;
          }
        };
        // Note: handleModelChange isn't async; fire-and-forget then early return after success
        if (!providerSpecific) {
          void (async () => {
            const fetched = await ensureFetched();
            if (fetched) {
              setSelectedModel(fetched);
              saveLastUsedModel(configuredKeyOverride!);
              setBaseUrl(normalized);
            }
          })();
          return;
        }
        console.log('rdlogs: providerSpecific', providerSpecific);
        if (providerSpecific) {
          setSelectedModel(providerSpecific);
          saveLastUsedModel(configuredKeyOverride);
          setBaseUrl(normalized);
          return;
        }
      } catch (e) {
        console.error('Failed to load provider-specific model from storage', e);
      }
    }
    else {
      // Fallback: use currently loaded combined models
      const model = models.find((m: Model) => m.id === modelId);
      if (model) {
        setSelectedModel(model);
        saveLastUsedModel(modelId);
        // Switch provider base URL if a provider is configured for this model
        try {
          const map = loadModelProviderMap();
          const mappedBase = map[modelId];
          console.log('rdlogs: mappedBase', mappedBase);
          if (mappedBase && typeof mappedBase === 'string' && mappedBase.length > 0) {
            const normalized = mappedBase.endsWith('/') ? mappedBase : `${mappedBase}/`;
            setBaseUrl(normalized);
          }
        } catch {}
      }
    }

  }, [models]);

  const setBaseUrl = useCallback((url: string) => {
    const normalizedUrl = url.endsWith('/') ? url : `${url}/`;
    setBaseUrlState(normalizedUrl);
    saveBaseUrl(normalizedUrl);
    const updatedBaseUrlsList = loadBaseUrlsList();
    setBaseUrlsList(updatedBaseUrlsList);
  }, []);

  return {
    models,
    selectedModel,
    isLoadingModels,
    baseUrl,
    setSelectedModel,
    setBaseUrl,
    fetchModels,
    handleModelChange,
    lowBalanceWarningForModel
  };
};