import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Model } from '@/data/models';
import { DEFAULT_BASE_URLS, DEFAULT_MINT_URL } from '@/lib/utils';
import { loadMintUrl, saveMintUrl, loadBaseUrl, saveBaseUrl, loadLastUsedModel, saveLastUsedModel, loadBaseUrlsList, saveBaseUrlsList, migrateCurrentCashuToken, loadModelProviderMap, saveModelProviderMap } from '@/utils/storageUtils';
import { toast } from 'sonner';

export interface UseApiStateReturn {
  models: Model[];
  selectedModel: Model | null;
  isLoadingModels: boolean;
  mintUrl: string;
  baseUrl: string;
  setModels: (models: Model[]) => void;
  setSelectedModel: (model: Model | null) => void;
  setIsLoadingModels: (loading: boolean) => void;
  setMintUrl: (url: string) => void;
  setBaseUrl: (url: string) => void;
  fetchModels: (balance: number) => Promise<void>; // Modified to accept balance
  handleModelChange: (modelId: string) => void;
}

/**
 * Custom hook for managing API configuration and model state
 * Handles API endpoint configuration, model fetching and caching,
 * model selection state, and API error handling
 */
export const useApiState = (isAuthenticated: boolean, balance: number): UseApiStateReturn => {
  const searchParams = useSearchParams();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [mintUrl, setMintUrlState] = useState('');
  const [baseUrl, setBaseUrlState] = useState('');
  const [baseUrlsList, setBaseUrlsList] = useState<string[]>([]);
  const [currentBaseUrlIndex, setCurrentBaseUrlIndex] = useState<number>(0);

  // Initialize URLs from storage
  useEffect(() => {
    if (isAuthenticated) {
      const currentMintUrl = loadMintUrl(DEFAULT_MINT_URL);
      setMintUrlState(currentMintUrl);

      const loadedBaseUrls = loadBaseUrlsList();
      setBaseUrlsList(loadedBaseUrls);

      const currentBaseUrl = loadBaseUrl(DEFAULT_BASE_URLS[0]);
      setBaseUrlState(currentBaseUrl);
      console.log('settings agin')

      const initialIndex = loadedBaseUrls.indexOf(currentBaseUrl);
      setCurrentBaseUrlIndex(initialIndex !== -1 ? initialIndex : 0);
    }
  }, [isAuthenticated]);

  // Migrate old cashu token format on load
  useEffect(() => {
    if (baseUrl) {
      migrateCurrentCashuToken(baseUrl);
    }
  }, [baseUrl]);

  // Fetch available models from API and handle URL model selection
  const fetchModels = useCallback(async (currentBalance: number) => {
    try {
      setIsLoadingModels(true);
      if (!baseUrlsList || baseUrlsList.length === 0) {
        setModels([]);
        return;
      }

      const results = await Promise.allSettled(
        baseUrlsList.map(async (url) => {
          const base = url.endsWith('/') ? url : `${url}/`;
          const res = await fetch(`${base}v1/models`);
          if (!res.ok) throw new Error(`Failed ${res.status}`);
          const json = await res.json();
          const list: Model[] = Array.isArray(json?.data) ? json.data : [];
          return { base, list };
        })
      );

      // Build best-priced model per id across providers and remember provider
      const bestById = new Map<string, { model: Model; base: string }>();

      function estimateMinCost(m: Model): number {
        try {
          const sp: any = m?.sats_pricing || {};
          const maxCompletion = typeof sp?.max_completion_cost === 'number' ? sp.max_completion_cost : undefined;
          const maxCost = typeof sp?.max_cost === 'number' ? sp.max_cost : undefined;
          if (typeof maxCompletion === 'number') {
            const promptRate = typeof sp?.prompt === 'number' ? sp.prompt : 0;
            const approxTokens = 2000;
            const promptCosts = promptRate * approxTokens;
            return promptCosts + maxCompletion;
          }
          if (typeof maxCost === 'number') return maxCost;
          return 0;
        } catch {
          return 0;
        }
      }

      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { base, list } = r.value;
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
      }

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

      // Select model based on URL param or last used
      let modelToSelect: Model | null = null;
      const urlModelId = searchParams.get('model');
      if (urlModelId) {
        modelToSelect = combinedModels.find((m: Model) => m.id === urlModelId) || null;
      }
      if (!modelToSelect) {
        const lastUsedModelId = loadLastUsedModel();
        if (lastUsedModelId) {
          modelToSelect = combinedModels.find((m: Model) => m.id === lastUsedModelId) || null;
        }
      }
      if (!modelToSelect) {
        const compatible = combinedModels.filter((m: Model) => m.sats_pricing && currentBalance >= (m.sats_pricing as any).max_cost);
        if (compatible.length > 0) modelToSelect = compatible[0];
      }
      setSelectedModel(modelToSelect);
      if (modelToSelect) saveLastUsedModel(modelToSelect.id);
    } catch (error) {
      console.error('Error while fetching models', error);
      setModels([]);
      setSelectedModel(null);
    } finally {
      setIsLoadingModels(false);
    }
  }, [searchParams, baseUrlsList]);

  // Fetch models when baseUrl or balance changes and user is authenticated
  useEffect(() => {
    if (isAuthenticated && baseUrlsList.length > 0) { // Ensure baseUrlsList is loaded
      fetchModels(balance);
    }
  }, [fetchModels, isAuthenticated, balance, baseUrlsList.length]); // Removed baseUrl, added baseUrlsList.length

  const handleModelChange = useCallback((modelId: string) => {
    const model = models.find((m: Model) => m.id === modelId);
    if (model) {
      setSelectedModel(model);
      saveLastUsedModel(modelId);
      // Switch provider base URL if a provider is configured for this model
      try {
        const map = loadModelProviderMap();
        const mappedBase = map[modelId];
        if (mappedBase && typeof mappedBase === 'string' && mappedBase.length > 0) {
          const normalized = mappedBase.endsWith('/') ? mappedBase : `${mappedBase}/`;
          setBaseUrl(normalized);
        }
      } catch {}
    }
  }, [models]);

  const setMintUrl = useCallback((url: string) => {
    setMintUrlState(url);
    saveMintUrl(url);
  }, []);

  const setBaseUrl = useCallback((url: string) => {
    const normalizedUrl = url.endsWith('/') ? url : `${url}/`;
    setBaseUrlState(normalizedUrl);
    saveBaseUrl(normalizedUrl);
    const updatedBaseUrlsList = loadBaseUrlsList();
    setBaseUrlsList(updatedBaseUrlsList);
    // Update the currentBaseUrlIndex if the URL is found in the list
    const index = updatedBaseUrlsList.indexOf(normalizedUrl);
    if (index !== -1) {
      setCurrentBaseUrlIndex(index);
    }
  }, [baseUrlsList]);

  return {
    models,
    selectedModel,
    isLoadingModels,
    mintUrl,
    baseUrl,
    setModels,
    setSelectedModel,
    setIsLoadingModels,
    setMintUrl,
    setBaseUrl,
    fetchModels,
    handleModelChange
  };
};