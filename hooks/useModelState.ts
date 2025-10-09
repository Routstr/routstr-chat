import { useState, useEffect, useCallback } from 'react';
import { loadConfiguredModels, saveConfiguredModels, loadModelProviderMap, saveModelProviderMap } from '@/utils/storageUtils';

export interface UseModelStateReturn {
  configuredModels: string[];
  setConfiguredModels: (models: string[]) => void;
  toggleConfiguredModel: (modelId: string) => void;
  modelProviderMap: Record<string, string>;
  setModelProviderFor: (modelId: string, baseUrl: string) => void;
}

/**
 * Custom hook for managing model selection and preferences
 * Handles model filtering and search, favorite models management,
 * model availability checking, and model change handling
 */
export const useModelState = (): UseModelStateReturn => {
  const [configuredModels, setConfiguredModelsState] = useState<string[]>([]);
  const [modelProviderMap, setModelProviderMapState] = useState<Record<string, string>>({});

  // Load configured models from storage on mount (migrates from favorites)
  useEffect(() => {
    const savedConfiguredModels = loadConfiguredModels();
    setConfiguredModelsState(savedConfiguredModels);
    const savedProviderMap = loadModelProviderMap();
    setModelProviderMapState(savedProviderMap);
  }, []);

  // Toggle configured model
  const toggleConfiguredModel = useCallback((modelId: string) => {
    setConfiguredModelsState(prev => {
      const updated = prev.includes(modelId)
        ? prev.filter(id => id !== modelId)
        : [...prev, modelId];
      saveConfiguredModels(updated);
      return updated;
    });
  }, []);

  const setConfiguredModels = useCallback((models: string[]) => {
    setConfiguredModelsState(models);
    saveConfiguredModels(models);
  }, []);

  const setModelProviderFor = useCallback((modelId: string, baseUrl: string) => {
    setModelProviderMapState(prev => {
      const updated = { ...prev, [modelId]: baseUrl };
      saveModelProviderMap(updated);
      return updated;
    });
  }, []);

  return {
    configuredModels,
    setConfiguredModels,
    toggleConfiguredModel,
    modelProviderMap,
    setModelProviderFor
  };
};