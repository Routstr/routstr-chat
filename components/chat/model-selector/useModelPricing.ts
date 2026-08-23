import { useCallback, useMemo } from "react";
import { useStore } from "zustand";
import { Model } from "@/types/models";
import { providerManager, store } from "@/sdk/sharedStore";
import { isTorContext } from "@/utils/torUtils";
import {
  parseModelKey,
  normalizeBaseUrl,
  getProviderFromModelName,
  getCachedProviderModels,
} from "@/utils/modelUtils";

const NO_ENTRIES: ProviderPricingEntry[] = [];

// The SDK only ranks providers whose sats_pricing has numeric prompt AND
// completion, so an entry's costs can always be read straight off its model.
export type ProviderPricingEntry = {
  baseUrl: string;
  model: Model;
};

export const entryPromptCost = (entry: ProviderPricingEntry) =>
  entry.model.sats_pricing.prompt;
export const entryCompletionCost = (entry: ProviderPricingEntry) =>
  entry.model.sats_pricing.completion;
// prompt+completion, the basis the SDK ranks on
export const entryTotalCost = (entry: ProviderPricingEntry) =>
  entry.model.sats_pricing.prompt + entry.model.sats_pricing.completion;

export function formatProviderLabel(
  baseUrl: string | null | undefined,
  model: Model
): string {
  try {
    if (baseUrl) {
      const url = new URL(normalizeBaseUrl(baseUrl) || "");
      return url.host;
    }
  } catch {}
  return getProviderFromModelName(model.name);
}

interface UseModelPricingArgs {
  models: Model[];
  disabledProviders: string[];
  modelProviderMap: Record<string, string>;
  configuredModels: string[];
  selectedModel: Model | null;
}

export function useModelPricing({
  models,
  disabledProviders,
  modelProviderMap,
  configuredModels,
  selectedModel,
}: UseModelPricingArgs) {
  // Keyed off the cache itself: a write that adds a provider without adding a
  // new model id would not change `models`, and the filter would miss it.
  const cachedModels = useStore(store, (s) => s.modelsFromAllProviders);
  // The ranking drops cooldown providers, so re-rank when that set changes.
  const providersOnCooldown = useStore(store, (s) => s.providersOnCooldown);

  // Ranking a model rescans the whole discovery cache, so it is done ONCE per
  // model here rather than per call. The sort comparator calls this O(n log n)
  // times; a useCallback would memoize the function and recompute every result.
  const pricingEntriesByModel = useMemo(() => {
    const torMode = isTorContext();
    const index = new Map<string, ProviderPricingEntry[]>();

    // selectedModel is included explicitly: the Current row still renders it
    // even when the filters exclude it from `models`.
    const targets = selectedModel ? [...models, selectedModel] : models;

    for (const model of targets) {
      if (index.has(model.id)) continue;
      // The SDK drops disabled and on-cooldown providers and sorts cheapest
      // first. Keep it as the one ranking authority.
      const ranking = providerManager.getProviderPriceRankingForModel(model.id, {
        torMode,
      });

      // Base urls are normalized here so they compare equal to the pinned bases
      // parsed out of `${id}@@${base}` favorite keys.
      index.set(
        model.id,
        ranking.flatMap((item) => {
          const baseUrl = normalizeBaseUrl(item.baseUrl);
          return baseUrl
            ? [{ baseUrl, model: item.model as unknown as Model }]
            : [];
        })
      );
    }

    return index;
  }, [models, selectedModel, disabledProviders, cachedModels, providersOnCooldown]);

  const getProviderPricingEntries = useCallback(
    (modelId: string): ProviderPricingEntry[] =>
      pricingEntriesByModel.get(modelId) ?? NO_ENTRIES,
    [pricingEntriesByModel]
  );

  // What a provider itself lists, whatever its routing state, so a row pinned to
  // a dropped provider can be priced without borrowing another provider's number.
  const getCachedModelFor = useCallback(
    (baseUrl: string | null, modelId: string): Model | undefined => {
      if (!baseUrl) return undefined;
      return getCachedProviderModels(baseUrl)?.find(
        (model) => model.id === modelId
      );
    },
    [cachedModels]
  );

  const providerOptions = useMemo(() => {
    const byBaseUrl = new Map<string, string>();
    const disabledProvidersSet = new Set(disabledProviders);
    const sampleModel = selectedModel ?? models[0];

    const addProvider = (base: string | null | undefined) => {
      const normalized = normalizeBaseUrl(base);
      if (!normalized || disabledProvidersSet.has(normalized)) return;
      if (!byBaseUrl.has(normalized)) {
        byBaseUrl.set(
          normalized,
          sampleModel ? formatProviderLabel(normalized, sampleModel) : normalized
        );
      }
    };

    // Includes providers that never win the ranking; they were unreachable before.
    Object.keys(cachedModels ?? {}).forEach(addProvider);
    // localStorage-backed, so it still seeds the list before the cache hydrates.
    Object.values(modelProviderMap).forEach(addProvider);
    configuredModels.forEach((key) => addProvider(parseModelKey(key).base));

    return Array.from(byBaseUrl.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [
    cachedModels,
    modelProviderMap,
    configuredModels,
    selectedModel,
    models,
    disabledProviders,
  ]);

  const pricingBounds = useMemo(() => {
    const prices = models
      .map((m) => m.sats_pricing?.completion)
      .filter((p): p is number => typeof p === "number" && p > 0 && isFinite(p));

    if (prices.length === 0) return { minLog: 0, maxLog: 4 };

    const sorted = [...prices].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)];
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];

    return { minLog: Math.log10(p5), maxLog: Math.log10(p95) };
  }, [models]);

  // 1 = cheapest, 5 = most expensive
  const getPricingIndex = useCallback(
    (satsPrice?: number): number | null => {
      if (
        typeof satsPrice !== "number" ||
        satsPrice <= 0 ||
        !isFinite(satsPrice)
      ) {
        return null;
      }

      const { minLog, maxLog } = pricingBounds;
      const range = maxLog - minLog;
      if (range <= 0) return 3;

      const normalized = 1 + ((Math.log10(satsPrice) - minLog) / range) * 4;
      return Math.round(Math.min(5, Math.max(1, normalized)) * 10) / 10;
    },
    [pricingBounds]
  );

  return {
    getProviderPricingEntries,
    getCachedModelFor,
    providerOptions,
    getPricingIndex,
  };
}
