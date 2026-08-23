import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Model } from "@/types/models";
import {
  MODEL_COMPANIES,
  getModelCompanyId,
} from "@/components/chat/modelCompanies";
import {
  getCachedProviderModels,
  getModelNameWithoutProvider,
  isModelAvailable,
  normalizeBaseUrl,
  parseModelKey,
} from "@/utils/modelUtils";
import { getStorageItem, setStorageItem } from "@/utils/storageUtils";
import { webSearchModels } from "@/lib/preconfiguredModels";
import { discoveryAdapter } from "@/sdk/sharedStore";
import { normalizeModality } from "./modality";
import { entryTotalCost, type ProviderPricingEntry } from "./useModelPricing";

export const MODEL_SORT_OPTIONS = [
  { value: "latest", label: "Latest" },
  { value: "cheapest", label: "Price" },
  { value: "context", label: "Context" },
  { value: "coverage", label: "Coverage" },
  { value: "name", label: "A-Z" },
] as const;

export type ModelSortMode = (typeof MODEL_SORT_OPTIONS)[number]["value"];

const INITIAL_MODEL_RENDER_LIMIT = 15;
export const MODEL_RENDER_INCREMENT = 15;

export interface CompanyFilter {
  id: string;
  label: string;
  shortLabel: string;
  count: number;
}

export type UseModelFiltersResult = ReturnType<typeof useModelFilters>;

// Favorites are stored as `${modelId}@@${baseUrl}` keys, so one model can own
// several rows there. Everywhere else a model is one row, provider chosen live.
export interface ModelRowEntry {
  model: Model;
  configuredKey?: string;
}

// Row identity. Hover, React keys and the current-row exclusion all use it, so
// sibling favorite rows stay distinct.
export const rowKeyOf = (entry: ModelRowEntry) =>
  entry.configuredKey ?? entry.model.id;

export const rowPinnedBase = (entry: ModelRowEntry) =>
  entry.configuredKey
    ? normalizeBaseUrl(parseModelKey(entry.configuredKey).base)
    : null;

// Which provider an UNPINNED row speaks for, shared by the list and the row
// renderer. Null means "no claim": the row resolves to the cheapest ranked
// entry, exactly what the SDK routes to, so the price shown is the price billed.
export const dynamicBaseFor = (selectedProvider: string) =>
  selectedProvider !== "all" ? selectedProvider : null;

// A pinned row resolves to its own provider or to nothing: the ranking drops
// disabled/cooling-down providers, and borrowing the next entry would price the
// row with a provider it will never call. Dynamic rows claim none, so the
// cheapest ranked entry is honest for them.
export function findRowPricingEntry(
  row: ModelRowEntry,
  entries: ProviderPricingEntry[],
  dynamicBase: string | null
): ProviderPricingEntry | null {
  const pinnedBase = rowPinnedBase(row);
  if (pinnedBase) {
    return entries.find((entry) => entry.baseUrl === pinnedBase) ?? null;
  }
  return (
    (dynamicBase
      ? entries.find((entry) => entry.baseUrl === dynamicBase)
      : undefined) ??
    entries[0] ??
    null
  );
}

interface UseModelFiltersArgs {
  models: Model[];
  selectedModel: Model | null;
  /** The key the chat is on, so only that exact row is excluded from the list. */
  currentConfiguredKey?: string;
  configuredModels: string[];
  effectiveBalance: number;
  providerOptions: { value: string; label: string }[];
  getProviderPricingEntries: (modelId: string) => ProviderPricingEntry[];
}

const normalizeForSearch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function useModelFilters({
  models,
  selectedModel,
  currentConfiguredKey,
  configuredModels,
  effectiveBalance,
  providerOptions,
  getProviderPricingEntries,
}: UseModelFiltersArgs) {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedCompany, setSelectedCompany] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [webSearchFilter, setWebSearchFilter] = useState(false);
  const [privateFilter, setPrivateFilter] = useState(false);
  const [imageFilter, setImageFilter] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [modelRenderLimit, setModelRenderLimit] = useState(
    INITIAL_MODEL_RENDER_LIMIT
  );

  const [sortMode, setSortMode] = useState<ModelSortMode>(() => {
    const saved = getStorageItem<string>("modelSelectorSort", "latest");
    return MODEL_SORT_OPTIONS.some((option) => option.value === saved)
      ? (saved as ModelSortMode)
      : "latest";
  });
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">(() =>
    getStorageItem<string>("modelSelectorSortDirection", "desc") === "asc"
      ? "asc"
      : "desc"
  );
  useEffect(() => {
    setStorageItem("modelSelectorSort", sortMode);
    setStorageItem("modelSelectorSortDirection", sortDirection);
  }, [sortMode, sortDirection]);

  const configuredModelIdSet = useMemo(
    () => new Set(configuredModels.map((key) => parseModelKey(key).id)),
    [configuredModels]
  );

  // Curated "Routstr 21" list. Keyed off models because the SDK store hydrates
  // async and an empty-deps memo would snapshot an empty list.
  const recommendedModelIdSet = useMemo(
    () => new Set(discoveryAdapter.getRoutstr21Models()),
    [models]
  );

  const isConfiguredModel = useCallback(
    (modelId: string) => configuredModelIdSet.has(modelId),
    [configuredModelIdSet]
  );

  const filteredModels = useMemo(() => {
    const normalizedQuery = normalizeForSearch(deferredSearchQuery);
    const rawQuery = deferredSearchQuery.toLowerCase();

    return models.filter((model) => {
      if (selectedCompany === "favorites") {
        if (!configuredModelIdSet.has(model.id)) return false;
      } else if (selectedCompany === "recommended") {
        if (!recommendedModelIdSet.has(model.id)) return false;
      } else if (
        selectedCompany !== "all" &&
        getModelCompanyId(model) !== selectedCompany
      ) {
        return false;
      }

      const modelName = getModelNameWithoutProvider(model.name);
      const matchesSearch =
        !normalizedQuery ||
        normalizeForSearch(modelName).includes(normalizedQuery) ||
        modelName.toLowerCase().includes(rawQuery) ||
        normalizeForSearch(model.id).includes(normalizedQuery) ||
        // Company prefix ("Meta", "OpenAI") so "meta" finds Llama etc.
        normalizeForSearch(model.name).includes(normalizedQuery);
      if (!matchesSearch) return false;

      if (webSearchFilter && !webSearchModels.includes(model.id)) return false;

      if (privateFilter && !model.id.startsWith("tinfoil")) return false;

      if (imageFilter) {
        const outputs = new Set(
          (model.architecture?.output_modalities ?? ["text"]).map(
            normalizeModality
          )
        );
        if (!outputs.has("image")) return false;
      }

      return true;
    });
  }, [
    models,
    deferredSearchQuery,
    selectedCompany,
    configuredModelIdSet,
    recommendedModelIdSet,
    webSearchFilter,
    privateFilter,
    imageFilter,
  ]);

  const companyFilters = useMemo<CompanyFilter[]>(() => {
    const counts = new Map<string, number>();
    for (const model of models) {
      const companyId = getModelCompanyId(model);
      counts.set(companyId, (counts.get(companyId) ?? 0) + 1);
    }

    // Counts ROWS, not model ids: Favorites renders one row per configured
    // provider key, so two providers for one model are two favorites.
    const visibleModelIds = new Set(models.map((model) => model.id));
    const favoriteCount = configuredModels.filter((key) =>
      visibleModelIds.has(parseModelKey(key).id)
    ).length;

    const filters: CompanyFilter[] = [
      {
        id: "favorites",
        label: "Favorites",
        shortLabel: "Fav",
        count: favoriteCount,
      },
      {
        id: "all",
        label: "All models",
        shortLabel: "All",
        count: models.length,
      },
    ];

    const recommendedCount = models.filter((model) =>
      recommendedModelIdSet.has(model.id)
    ).length;
    if (recommendedCount > 0) {
      filters.splice(1, 0, {
        id: "recommended",
        label: "Recommended",
        shortLabel: "Rec",
        count: recommendedCount,
      });
    }

    for (const company of MODEL_COMPANIES) {
      const count = counts.get(company.id) ?? 0;
      if (count > 0) {
        filters.push({
          id: company.id,
          label: company.label,
          shortLabel: company.shortLabel,
          count,
        });
      }
    }

    const otherCount = counts.get("other") ?? 0;
    if (otherCount > 0) {
      filters.push({
        id: "other",
        label: "Other",
        shortLabel: "OT",
        count: otherCount,
      });
    }

    return filters;
  }, [models, configuredModels, recommendedModelIdSet]);

  const allModelEntries = useMemo<ModelRowEntry[]>(() => {
    const rowEntry = (row: ModelRowEntry) =>
      findRowPricingEntry(
        row,
        getProviderPricingEntries(row.model.id),
        dynamicBaseFor(selectedProvider)
      );

    // Null when a pinned provider cannot serve it: unroutable, fails "Can run".
    const rowModel = (row: ModelRowEntry): Model | null =>
      rowEntry(row)?.model ?? (rowPinnedBase(row) ? null : row.model);

    // prompt+completion, matching the SDK ranking basis. Completion alone made
    // the model order contradict the provider order in the details pane.
    const rowCost = (row: ModelRowEntry) => {
      const entry = rowEntry(row);
      if (entry) return entryTotalCost(entry);
      const { prompt, completion } = rowModel(row)?.sats_pricing ?? {};
      if (typeof prompt === "number" && typeof completion === "number") {
        return prompt + completion;
      }
      return Number.POSITIVE_INFINITY;
    };

    // Only the exact current row is excluded, so a model favorited on two
    // providers keeps its other row.
    const isCurrentRow = (row: ModelRowEntry) => {
      if (!selectedModel || row.model.id !== selectedModel.id) return false;
      return row.configuredKey
        ? row.configuredKey === currentConfiguredKey
        : true;
    };

    // Rows are built BEFORE filtering so each filter sees the row's own provider.
    // Favorites are keyed off configuredModels, so one missing from the fetched
    // list (cold load, provider down) falls back to its cache instead of vanishing.
    const rows: ModelRowEntry[] =
      selectedCompany === "favorites"
        ? configuredModels.flatMap((key) => {
            const { id, base } = parseModelKey(key);
            const model =
              filteredModels.find((m) => m.id === id) ??
              (base
                ? getCachedProviderModels(base)?.find((m) => m.id === id)
                : undefined);
            return model ? [{ model, configuredKey: key }] : [];
          })
        : filteredModels.map((model) => ({ model }));

    return rows
      .filter((row) => !isCurrentRow(row))
      .filter((row) => {
        if (selectedProvider === "all") return true;
        const base = rowPinnedBase(row);
        // A pinned row must BE the provider; an unpinned row need only be served by it.
        if (base) return base === selectedProvider;
        return getProviderPricingEntries(row.model.id).some(
          (entry) => entry.baseUrl === selectedProvider
        );
      })
      .filter((row) => {
        if (!availableOnly) return true;
        const model = rowModel(row);
        return !!model && isModelAvailable(model, effectiveBalance);
      })
      .sort((a, b) => {
        // Rows missing the metric sink regardless of direction; ties break A->Z.
        // Affordability dims a row, it never overrides an explicit sort.
        const metricOf = (row: ModelRowEntry): number | null => {
          switch (sortMode) {
            case "latest": {
              const created = Number(row.model.created ?? 0);
              return created > 0 ? created : null;
            }
            case "cheapest": {
              // Some community providers report negative/garbage prices;
              // treat anything below zero as unpriced so it sinks.
              const cost = rowCost(row);
              return isFinite(cost) && cost >= 0 ? cost : null;
            }
            case "context": {
              const context = Number(row.model.context_length ?? 0);
              return context > 0 ? context : null;
            }
            case "coverage":
              return getProviderPricingEntries(row.model.id).length;
            default:
              return null;
          }
        };

        const aMetric = metricOf(a);
        const bMetric = metricOf(b);
        if ((aMetric === null) !== (bMetric === null)) {
          return aMetric === null ? 1 : -1;
        }

        if (aMetric !== null && bMetric !== null) {
              const natural =
            sortMode === "cheapest" ? aMetric - bMetric : bMetric - aMetric;
          const diff = natural * (sortDirection === "asc" ? -1 : 1);
          if (diff !== 0) return diff;
        }

        // Primary key in "name" mode (follows the direction toggle); elsewhere
        // only a stable tiebreaker.
        const nameCompare = getModelNameWithoutProvider(
          a.model.name
        ).localeCompare(getModelNameWithoutProvider(b.model.name));
        if (nameCompare !== 0) {
          return sortMode === "name" && sortDirection === "asc"
            ? -nameCompare
            : nameCompare;
        }
        return (a.configuredKey ?? "").localeCompare(b.configuredKey ?? "");
      });
  }, [
    filteredModels,
    selectedModel?.id,
    currentConfiguredKey,
    selectedProvider,
    availableOnly,
    effectiveBalance,
    sortMode,
    sortDirection,
    selectedCompany,
    configuredModels,
    getProviderPricingEntries,
  ]);

  const visibleAllModelEntries = useMemo(
    () => allModelEntries.slice(0, modelRenderLimit),
    [allModelEntries, modelRenderLimit]
  );

  const hiddenModelCount = allModelEntries.length - visibleAllModelEntries.length;

  const handleLoadMore = useCallback(() => {
    setModelRenderLimit((limit) => limit + MODEL_RENDER_INCREMENT);
  }, []);

  useEffect(() => {
    setModelRenderLimit(INITIAL_MODEL_RENDER_LIMIT);
  }, [
    deferredSearchQuery,
    selectedCompany,
    privateFilter,
    webSearchFilter,
    imageFilter,
    availableOnly,
    selectedProvider,
    sortMode,
    sortDirection,
  ]);

  useEffect(() => {
    if (!companyFilters.some((filter) => filter.id === selectedCompany)) {
      setSelectedCompany("all");
    }
  }, [companyFilters, selectedCompany]);

  useEffect(() => {
    if (
      selectedProvider !== "all" &&
      !providerOptions.some((provider) => provider.value === selectedProvider)
    ) {
      setSelectedProvider("all");
    }
  }, [providerOptions, selectedProvider]);

  const activeCompanyFilterLabel =
    companyFilters.find((filter) => filter.id === selectedCompany)?.label ??
    "All models";

  const hasActiveModelFilters =
    webSearchFilter ||
    privateFilter ||
    imageFilter ||
    availableOnly ||
    selectedProvider !== "all";

  return {
    searchQuery,
    setSearchQuery,
    deferredSearchQuery,
    selectedCompany,
    setSelectedCompany,
    selectedProvider,
    setSelectedProvider,
    sortMode,
    setSortMode,
    sortDirection,
    setSortDirection,
    webSearchFilter,
    setWebSearchFilter,
    privateFilter,
    setPrivateFilter,
    imageFilter,
    setImageFilter,
    availableOnly,
    setAvailableOnly,
    allModelEntries,
    visibleAllModelEntries,
    hiddenModelCount,
    handleLoadMore,
    companyFilters,
    activeCompanyFilterLabel,
    hasActiveModelFilters,
    isConfiguredModel,
  };
}
