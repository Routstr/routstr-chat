import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Search,
  Settings,
  Sparkles,
  Star,
  Info,
  Image as ImageIcon,
  Type,
  Mic,
  Video,
  Copy,
  Check,
  Globe,
  Bitcoin,
  Lock,
} from "lucide-react";
import {
  AwsIcon,
  ClaudeIcon,
  CohereIcon,
  DeepSeekIcon,
  GeminiIcon,
  GrokIcon,
  KimiIcon,
  MetaIcon,
  MinimaxIcon,
  MistralIcon,
  NvidiaIcon,
  OpenAIIcon,
  PerplexityIcon,
  QwenIcon,
  ZAIIcon,
} from "@/components/icons/companyIcons";
import type { ReactNode } from "react";
import { Model } from "@/types/models";
import {
  getModelNameWithoutProvider,
  getProviderFromModelName,
} from "@/utils/modelUtils";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  loadModelProviderMap,
  getStorageItem,
  setStorageItem,
} from "@/utils/storageUtils";
import { useDisabledProviders } from "@/hooks/useDisabledProviders";
import {
  parseModelKey,
  normalizeBaseUrl,
  getRequiredSatsForModel,
  isModelAvailable,
} from "@/utils/modelUtils";
import { webSearchModels } from "@/lib/preconfiguredModels";
import { discoveryAdapter, providerManager } from "@/sdk/sharedStore";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";

interface ModelSelectorProps {
  selectedModel: Model | null;
  isModelDrawerOpen: boolean;
  setIsModelDrawerOpen: (isOpen: boolean) => void;
  isAuthenticated: boolean;
  setIsLoginModalOpen: (isOpen: boolean) => void;
  isWalletLoading: boolean;
  isLoadingModels: boolean;
  filteredModels: Model[];
  handleModelChange: (modelId: string, configuredKeyOverride?: string) => void;
  balance: number;
  configuredModels: string[];
  openModelsConfig?: () => void;
  toggleConfiguredModel: (modelId: string) => void;
  setModelProviderFor?: (modelId: string, baseUrl: string) => void;
  baseUrl?: string;
  lowBalanceWarningForModel: boolean;
}

type ProviderPricingEntry = {
  baseUrl: string;
  providerLabel: string;
  promptCost: number | null;
  completionCost: number | null;
  model: Model;
};

type ModelCompanyDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  keywords: string[];
};

// Order is deliberate: it sets the company rail order (roughly by how much
// the network actually uses each lab) and doubles as keyword-match priority
// in getModelCompanyId.
const MODEL_COMPANIES: ModelCompanyDefinition[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    shortLabel: "AN",
    keywords: ["anthropic", "claude"],
  },
  {
    id: "openai",
    label: "OpenAI",
    shortLabel: "OA",
    keywords: ["openai", "gpt", "chatgpt", "o1", "o3", "o4"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    shortLabel: "DS",
    keywords: ["deepseek"],
  },
  {
    id: "zhipu",
    label: "Zhipu AI",
    shortLabel: "GL",
    keywords: ["zhipu", "glm"],
  },
  {
    id: "moonshot",
    label: "Moonshot",
    shortLabel: "KI",
    keywords: ["moonshot", "kimi"],
  },
  {
    id: "minimax",
    label: "MiniMax",
    shortLabel: "MM",
    keywords: ["minimax"],
  },
  {
    id: "google",
    label: "Google",
    shortLabel: "GO",
    keywords: ["google", "gemini", "gemma"],
  },
  {
    id: "alibaba",
    label: "Alibaba",
    shortLabel: "QW",
    keywords: ["alibaba", "qwen", "qwq", "wan"],
  },
  {
    id: "xai",
    label: "xAI",
    shortLabel: "xA",
    keywords: ["xai", "grok"],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    shortLabel: "PX",
    keywords: ["perplexity", "sonar", "pplx"],
  },
  {
    id: "mistral",
    label: "Mistral",
    shortLabel: "MI",
    keywords: ["mistral", "mixtral", "codestral", "ministral"],
  },
  {
    id: "meta",
    label: "Meta",
    shortLabel: "ME",
    keywords: ["meta", "llama"],
  },
  {
    id: "cohere",
    label: "Cohere",
    shortLabel: "CO",
    keywords: ["cohere", "command"],
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    shortLabel: "NV",
    keywords: ["nvidia", "nemotron"],
  },
  {
    id: "amazon",
    label: "Amazon",
    shortLabel: "AZ",
    keywords: ["amazon", "nova"],
  },
];

type CompanyIconComponent = typeof OpenAIIcon;

const COMPANY_ICON_COMPONENTS: Partial<Record<string, CompanyIconComponent>> = {
  openai: OpenAIIcon,
  anthropic: ClaudeIcon,
  google: GeminiIcon,
  deepseek: DeepSeekIcon,
  xai: GrokIcon,
  perplexity: PerplexityIcon,
  alibaba: QwenIcon,
  moonshot: KimiIcon,
  mistral: MistralIcon,
  meta: MetaIcon,
  minimax: MinimaxIcon,
  zhipu: ZAIIcon,
  cohere: CohereIcon,
  nvidia: NvidiaIcon,
  amazon: AwsIcon,
};

const getModelCompanyId = (model: Model): string => {
  const haystack = `${model.id} ${model.name}`.toLowerCase();
  return (
    MODEL_COMPANIES.find((company) =>
      company.keywords.some((keyword) => haystack.includes(keyword))
    )?.id ?? "other"
  );
};

const getCompanyMeta = (id: string) =>
  MODEL_COMPANIES.find((company) => company.id === id) ?? {
    id: "other",
    label: "Other",
    shortLabel: "OT",
    keywords: [],
  };

type ModelSortMode =
  | "latest"
  | "cheapest"
  | "context"
  | "coverage"
  | "name";

const MODEL_SORT_OPTIONS: { value: ModelSortMode; label: string }[] = [
  { value: "latest", label: "Latest" },
  { value: "cheapest", label: "Price" },
  { value: "context", label: "Context" },
  { value: "coverage", label: "Coverage" },
  { value: "name", label: "A-Z" },
];

const INITIAL_MODEL_RENDER_LIMIT = 15;
const MODEL_RENDER_INCREMENT = 15;

// Self-observing infinite-scroll sentinel. The list is rendered twice (mobile
// and desktop views), so each copy must watch its own element; a shared ref
// would only track the last-rendered one. Re-arms on hiddenCount so it keeps
// loading when it is still in view after a batch renders.
function LoadMoreSentinel({
  hiddenCount,
  onLoadMore,
}: {
  hiddenCount: number;
  onLoadMore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = ref.current;
    if (!sentinel || hiddenCount <= 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hiddenCount, onLoadMore]);

  return (
    <div
      ref={ref}
      className="flex h-10 items-center justify-center text-[11px] font-medium text-muted-foreground/50"
      aria-hidden="true"
    >
      Loading more...
    </div>
  );
}

export default function ModelSelector({
  selectedModel,
  isModelDrawerOpen,
  setIsModelDrawerOpen,
  isAuthenticated,
  setIsLoginModalOpen,
  isWalletLoading,
  isLoadingModels,
  filteredModels: dedupedModelsRaw,
  handleModelChange,
  balance,
  configuredModels,
  openModelsConfig,
  toggleConfiguredModel,
  setModelProviderFor,
  baseUrl,
  lowBalanceWarningForModel,
}: ModelSelectorProps) {
  // The providers list every model they serve, including embedding models
  // (output_modalities: ["embeddings"]) that return vectors, not text, and
  // fail in /chat/completions. Only surface models that can answer in chat.
  const dedupedModels = useMemo(
    () =>
      dedupedModelsRaw.filter((model) => {
        const outputs = model.architecture?.output_modalities;
        if (!outputs || outputs.length === 0) return true;
        return outputs.some((o) => o === "text" || o === "image");
      }),
    [dedupedModelsRaw]
  );

  const modelDrawerRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Disabled providers come from the SDK store (single source of truth used
  // for routing), not a separate localStorage list.
  const { disabledProviders } = useDisabledProviders();
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [activeView, setActiveView] = useState<"list" | "details">("list");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [detailsModel, setDetailsModel] = useState<Model | null>(null);
  const [modelProviderMap, setModelProviderMap] = useState<
    Record<string, string>
  >({});
  const [providerModelCache] = useState<Record<string, Record<string, Model>>>(
    {}
  );
  const [detailsBaseUrl, setDetailsBaseUrl] = useState<string | null>(null);
  const [webSearchFilter, setWebSearchFilter] = useState<boolean>(false);
  const [privateFilter, setPrivateFilter] = useState<boolean>(false);
  const [imageFilter, setImageFilter] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("all");
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
  const [selectedCompany, setSelectedCompany] = useState("all");
  const [modelRenderLimit, setModelRenderLimit] = useState(
    INITIAL_MODEL_RENDER_LIMIT
  );
  const [copiedModelId, setCopiedModelId] = useState<string | null>(null);
  // Custom dropdown open states (replacing native <select> for dark theme)
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const providerDropdownRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  // Drawer open/close animation state
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isDrawerAnimating, setIsDrawerAnimating] = useState(false);
  const effectiveBalance = balance + getPendingCashuTokenAmount();

  const configuredModelIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const key of configuredModels) {
      const parsed = parseModelKey(key);
      ids.add(parsed.id);
    }
    return ids;
  }, [configuredModels]);

  // Curated "Routstr 21" list published by the network (SDK discovery data)
  const recommendedModelIdSet = useMemo(
    () => new Set(discoveryAdapter.getRoutstr21Models()),
    []
  );

  useEffect(() => {
    try {
      setModelProviderMap(loadModelProviderMap());
    } catch {
      setModelProviderMap({});
    }
  }, []);

  // Reload modelProviderMap when models change (in case it was updated by useApiState)
  useEffect(() => {
    try {
      const updatedMap = loadModelProviderMap();
      setModelProviderMap(updatedMap);
    } catch {
      // Keep existing map if loading fails
    }
  }, [dedupedModels]);

  // Current model helpers for top-of-list section
  const currentConfiguredKeyMemo: string | undefined = useMemo(() => {
    if (!selectedModel) return undefined;
    const preferred = configuredModels.find((k) =>
      k.startsWith(`${selectedModel.id}@@`)
    );
    if (preferred) return preferred;
    const anyKey = configuredModels.find((k) => k === selectedModel.id);
    return anyKey;
  }, [configuredModels, selectedModel]);

  // Determine the currently selected provider base from active API baseUrl when available
  const currentSelectedBaseUrl: string | null = useMemo(() => {
    const normFromApi = normalizeBaseUrl(baseUrl);
    if (normFromApi) return normFromApi;
    // Fallback to base encoded in the configured key
    if (currentConfiguredKeyMemo && currentConfiguredKeyMemo.includes("@@")) {
      const parsed = parseModelKey(currentConfiguredKeyMemo);
      return normalizeBaseUrl(parsed.base);
    }
    // Final fallback to best-priced mapping
    if (selectedModel) {
      return normalizeBaseUrl(modelProviderMap[selectedModel.id]);
    }
    return null;
  }, [baseUrl, currentConfiguredKeyMemo, selectedModel, modelProviderMap]);

  // Normalize provider modality strings to canonical categories used for icons/filters
  const normalizeModality = (
    value: unknown
  ): "text" | "image" | "audio" | "video" => {
    const k = String(value ?? "").toLowerCase();
    if (
      k === "image" ||
      k === "images" ||
      k === "img" ||
      k === "vision" ||
      k === "picture" ||
      k === "photo"
    )
      return "image";
    if (k === "audio" || k === "sound" || k === "speech" || k === "voice")
      return "audio";
    if (k === "video" || k === "videos") return "video";
    // Treat unknowns (e.g., "file", "document", "json") as text for display purposes
    return "text";
  };

  // Normalize a string for fuzzy matching by stripping non-alphanumeric chars
  const normalizeForSearch = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Filter models based on search query, company, and capability toggles.
  const filteredModels = useMemo(() => {
    const normalizedQuery = normalizeForSearch(deferredSearchQuery);
    const rawQuery = deferredSearchQuery.toLowerCase();

    return dedupedModels.filter((model) => {
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

      if (webSearchFilter && !webSearchModels.includes(model.id)) {
        return false;
      }

      // Apply private (E2EE) filter
      if (privateFilter && !model.id.startsWith("tinfoil")) {
        return false;
      }

      const outputs = new Set(
        (model.architecture?.output_modalities ?? ["text"]).map(
          normalizeModality
        )
      );

      if (imageFilter && !outputs.has("image")) {
        return false;
      }

      return true;
    });
  }, [
    dedupedModels,
    deferredSearchQuery,
    selectedCompany,
    configuredModelIdSet,
    webSearchFilter,
    privateFilter,
    imageFilter,
  ]);

  // Determine which model's details to show in the right pane
  const previewModel: Model | null = useMemo(() => {
    const fromHover = filteredModels.find((m) => m.id === hoveredModelId);
    if (fromHover) return fromHover;
    if (selectedModel) return selectedModel as Model;
    return filteredModels[0] ?? null;
  }, [filteredModels, hoveredModelId, selectedModel]);

  // Display helpers: convert sats/token -> sats/1M tokens
  const computeSatsPer1M = (satsPerToken?: number): number | null => {
    if (
      typeof satsPerToken !== "number" ||
      !isFinite(satsPerToken) ||
      satsPerToken <= 0
    )
      return null;
    return satsPerToken * 1_000_000;
  };

  const formatSatsPer1M = (satsPerToken?: number): string => {
    const value = computeSatsPer1M(satsPerToken);
    if (value === null) return "-";
    if (value >= 100)
      return `${Math.round(value).toLocaleString()} sat/1M tokens`;
    return `${value.toFixed(2)} sat/1M tokens`;
  };

  // Percentile-based log prices for normalization (excludes extreme outliers)
  const pricingBounds = useMemo(() => {
    const prices = dedupedModels
      .map((m) => m.sats_pricing?.completion)
      .filter(
        (p): p is number => typeof p === "number" && p > 0 && isFinite(p)
      );

    if (prices.length === 0) return { minLog: 0, maxLog: 4 };

    // Sort prices and use 5th/95th percentiles to exclude extreme outliers
    const sorted = [...prices].sort((a, b) => a - b);
    const p5Index = Math.floor(sorted.length * 0.05);
    const p95Index = Math.min(
      sorted.length - 1,
      Math.floor(sorted.length * 0.95)
    );
    const p5 = sorted[p5Index];
    const p95 = sorted[p95Index];

    return {
      minLog: Math.log10(p5),
      maxLog: Math.log10(p95),
    };
  }, [dedupedModels]);

  // Normalized pricing index: 1 = cheapest, 5 = most expensive
  const getPricingIndex = (satsPrice?: number): number | null => {
    if (
      typeof satsPrice !== "number" ||
      satsPrice <= 0 ||
      !isFinite(satsPrice)
    ) {
      return null;
    }

    const { minLog, maxLog } = pricingBounds;
    const range = maxLog - minLog;
    if (range <= 0) return 3; // All models same price

    // Normalize to 1-5 scale (min price -> 1, max price -> 5)
    const normalized = 1 + ((Math.log10(satsPrice) - minLog) / range) * 4;
    return Math.round(Math.min(5, Math.max(1, normalized)) * 10) / 10;
  };

  const formatProviderLabel = (
    baseUrl: string | null | undefined,
    model: Model
  ): string => {
    try {
      if (baseUrl) {
        const url = new URL(normalizeBaseUrl(baseUrl) || "");
        return url.host;
      }
    } catch {}
    return getProviderFromModelName(model.name);
  };

  const getProviderPricingEntries = useCallback(
    (modelId: string): ProviderPricingEntry[] => {
      // Delegate to the SDK's ProviderManager, which reads from the canonical
      // IndexedDB-backed discovery cache (not the legacy localStorage mirror),
      // filters disabled + on-cooldown providers, and sorts by total
      // prompt+completion cost per 1M tokens (cheapest first).
      const ranking = providerManager.getProviderPriceRankingForModel(modelId);
      const entriesMap = new Map<string, ProviderPricingEntry>();

      for (const item of ranking) {
        const normalized = normalizeBaseUrl(item.baseUrl);
        if (!normalized) continue;
        // SDK returns sats-per-1M; convert back to sats-per-token so the
        // existing formatSatsPer1M() formatter (which multiplies by 1M) and
        // percentDelta comparisons keep working unchanged.
        entriesMap.set(normalized, {
          baseUrl: normalized,
          providerLabel: formatProviderLabel(
            normalized,
            item.model as unknown as Model
          ),
          promptCost: item.promptPerMillion / 1_000_000,
          completionCost: item.completionPerMillion / 1_000_000,
          // SDK Model has optional fields where the local Model type requires
          // them; provider-discovery payloads are fully populated at runtime.
          model: item.model as unknown as Model,
        });
      }

      // SDK ranking is already sorted cheapest-first (by totalPerMillion);
      // Map preserves insertion order so we keep that ordering.
      return Array.from(entriesMap.values());
    },
    [disabledProviders]
  );

  const getBestPricingEntry = useCallback(
    (modelId: string) => getProviderPricingEntries(modelId)[0],
    [getProviderPricingEntries]
  );

  const providerOptions = useMemo(() => {
    const byBaseUrl = new Map<string, string>();
    const disabledProvidersSet = new Set(disabledProviders);
    const sampleModel = selectedModel ?? dedupedModels[0];

    const addProvider = (baseUrl: string | null | undefined) => {
      const normalized = normalizeBaseUrl(baseUrl);
      if (!normalized || disabledProvidersSet.has(normalized)) return;
      if (!byBaseUrl.has(normalized)) {
        byBaseUrl.set(
          normalized,
          sampleModel ? formatProviderLabel(normalized, sampleModel) : normalized
        );
      }
    };

    Object.values(modelProviderMap).forEach(addProvider);
    configuredModels.forEach((key) => addProvider(parseModelKey(key).base));
    addProvider(baseUrl);

    return Array.from(byBaseUrl.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [
    modelProviderMap,
    configuredModels,
    baseUrl,
    selectedModel,
    dedupedModels,
    disabledProviders,
  ]);

  useEffect(() => {
    if (
      selectedProvider !== "all" &&
      !providerOptions.some((provider) => provider.value === selectedProvider)
    ) {
      setSelectedProvider("all");
    }
  }, [providerOptions, selectedProvider]);

  const selectProviderForModel = (model: Model, baseUrl: string) => {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return;
    setModelProviderMap((prev) => ({ ...prev, [model.id]: normalized }));
    setModelProviderFor?.(model.id, normalized);
    setDetailsBaseUrl(normalized);
    handleModelChange(model.id, `${model.id}@@${normalized}`);
  };

  // Treat a model as configured if any configured key matches its id or `${id}@@...`
  const isConfiguredModel = useCallback(
    (modelId: string) => configuredModelIdSet.has(modelId),
    [configuredModelIdSet]
  );

  // Calculate unique models and providers for display (excluding disabled providers)
  const { uniqueModelCount, uniqueProviderCount } = useMemo(() => {
    const uniqueProviders = new Set<string>();
    const enabledModels = new Set<string>();

    for (const model of dedupedModels) {
      const baseUrl = modelProviderMap[model.id];
      if (baseUrl) {
        const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
        // Only count if not disabled
        if (!disabledProviders.includes(normalized)) {
          uniqueProviders.add(normalized);
          enabledModels.add(model.id);
        }
      }
    }

    return {
      uniqueModelCount: enabledModels.size,
      uniqueProviderCount: uniqueProviders.size,
    };
  }, [dedupedModels, modelProviderMap, disabledProviders]);

  const companyFilters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of dedupedModels) {
      const companyId = getModelCompanyId(model);
      counts.set(companyId, (counts.get(companyId) ?? 0) + 1);
    }

    const filters = [
      {
        id: "favorites",
        label: "Favorites",
        shortLabel: "Fav",
        count: configuredModelIdSet.size,
      },
      {
        id: "all",
        label: "All models",
        shortLabel: "All",
        count: dedupedModels.length,
      },
    ];

    const recommendedCount = dedupedModels.filter((model) =>
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
  }, [dedupedModels, configuredModelIdSet, recommendedModelIdSet]);

  useEffect(() => {
    if (!companyFilters.some((filter) => filter.id === selectedCompany)) {
      setSelectedCompany("all");
    }
  }, [companyFilters, selectedCompany]);

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

  // Current model helpers for top-of-list section (alias to memoized key)
  const currentConfiguredKey: string | undefined = currentConfiguredKeyMemo;

  const currentProviderLabel: string | undefined = useMemo(() => {
    if (!selectedModel) return undefined;
    let base: string | null = null;
    if (currentConfiguredKey) {
      const parsed = parseModelKey(currentConfiguredKey);
      base = parsed.base;
    }
    const mappedBase =
      base ||
      modelProviderMap[currentConfiguredKey || ""] ||
      modelProviderMap[selectedModel.id];
    return formatProviderLabel(mappedBase, selectedModel);
  }, [selectedModel, currentConfiguredKey, modelProviderMap]);

  const allModelEntries = useMemo(() => {
    const getBestCost = (model: Model) => {
      const best = getBestPricingEntry(model.id);
      return (
        best?.completionCost ??
        (typeof model.sats_pricing?.completion === "number"
          ? model.sats_pricing.completion
          : Number.POSITIVE_INFINITY)
      );
    };

    const getProviderCount = (model: Model) =>
      getProviderPricingEntries(model.id).length;

    const getComparableModel = (model: Model) =>
      selectedProvider === "all"
        ? getBestPricingEntry(model.id)?.model ?? model
        : getProviderPricingEntries(model.id).find(
            (entry) => entry.baseUrl === selectedProvider
          )?.model ?? model;

    return filteredModels
      .filter((model) => model.id !== selectedModel?.id)
      .filter((model) => {
        if (selectedProvider === "all") return true;
        return getProviderPricingEntries(model.id).some(
          (entry) => entry.baseUrl === selectedProvider
        );
      })
      .filter((model) => {
        if (!availableOnly) return true;
        return isModelAvailable(getComparableModel(model), effectiveBalance);
      })
      .sort((a, b) => {
        // Sort strictly by the chosen metric. Models missing that metric sink
        // to the bottom regardless of direction; ties always break A->Z.
        // Affordability is shown by dimming + the "Can run" filter, it does
        // not override an explicit sort.
        const metricOf = (model: Model): number | null => {
          switch (sortMode) {
            case "latest": {
              const created = Number(model.created ?? 0);
              return created > 0 ? created : null;
            }
            case "cheapest": {
              // Some community providers report negative/garbage prices;
              // treat anything below zero as unpriced so it sinks.
              const cost = getBestCost(model);
              return isFinite(cost) && cost >= 0 ? cost : null;
            }
            case "context": {
              const context = Number(model.context_length ?? 0);
              return context > 0 ? context : null;
            }
            case "coverage":
              return getProviderCount(model);
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
          // Natural order: cheapest ascending, everything else descending
          const natural =
            sortMode === "cheapest" ? aMetric - bMetric : bMetric - aMetric;
          const diff = natural * (sortDirection === "asc" ? -1 : 1);
          if (diff !== 0) return diff;
        }

        return getModelNameWithoutProvider(a.name).localeCompare(
          getModelNameWithoutProvider(b.name)
        );
      });
  }, [
    filteredModels,
    selectedModel?.id,
    selectedProvider,
    availableOnly,
    effectiveBalance,
    sortMode,
    sortDirection,
    getProviderPricingEntries,
    getBestPricingEntry,
  ]);

  const visibleAllModelEntries = useMemo(
    () => allModelEntries.slice(0, modelRenderLimit),
    [allModelEntries, modelRenderLimit]
  );

  const hiddenModelCount = Math.max(
    0,
    allModelEntries.length - visibleAllModelEntries.length
  );

  // Load more models as the sentinel at the list end scrolls into view
  const handleLoadMore = useCallback(() => {
    setModelRenderLimit((limit) => limit + MODEL_RENDER_INCREMENT);
  }, []);

  // Keyboard navigation over the visible list (from the search input)
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [deferredSearchQuery, selectedCompany, sortMode, sortDirection]);

  const activeCompanyFilterLabel =
    companyFilters.find((filter) => filter.id === selectedCompany)?.label ??
    "All models";

  const hasActiveModelFilters =
    webSearchFilter ||
    privateFilter ||
    imageFilter ||
    availableOnly ||
    selectedProvider !== "all";

  const renderCompanyIcon = (
    companyId: string,
    className = "h-4 w-4"
  ): ReactNode => {
    if (companyId === "all") {
      return <Globe className={className} aria-hidden="true" />;
    }
    if (companyId === "favorites") {
      return <Star className={className} aria-hidden="true" />;
    }
    if (companyId === "recommended") {
      return <Sparkles className={className} aria-hidden="true" />;
    }

    const Icon = COMPANY_ICON_COMPONENTS[companyId];
    if (!Icon) {
      return (
        <span
          className="text-[10px] font-bold leading-none"
          aria-hidden="true"
        >
          {getCompanyMeta(companyId).shortLabel}
        </span>
      );
    }

    return <Icon size="1em" className={className} aria-hidden="true" />;
  };

  // Focus search input when drawer opens
  useEffect(() => {
    if (isModelDrawerOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    } else {
      setSearchQuery("");
    }
  }, [isModelDrawerOpen]);

  // Reset mobile view state when opening/closing
  useEffect(() => {
    if (isModelDrawerOpen) {
      setActiveView("list");
      setDetailsModel(null);
      setIsTransitioning(false);
    }
  }, [isModelDrawerOpen]);

  // Page-like transition for mobile
  const navigateToView = (view: "list" | "details") => {
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveView(view);
      setIsTransitioning(false);
    }, 150);
  };

  // Close model drawer when clicking outside (ignore clicks on the toggle button)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (!isModelDrawerOpen) return;
      const target = event.target as Node;
      const clickedInsideDrawer = modelDrawerRef.current?.contains(target);
      const clickedToggle = toggleButtonRef.current?.contains(target);
      if (!clickedInsideDrawer && !clickedToggle) setIsModelDrawerOpen(false);
    };

    if (isModelDrawerOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside, {
        passive: true,
      });
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isModelDrawerOpen, setIsModelDrawerOpen]);

  // Close custom dropdowns on click outside
  useEffect(() => {
    const handleDropdownClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        isProviderDropdownOpen &&
        !providerDropdownRef.current?.contains(target)
      ) {
        setIsProviderDropdownOpen(false);
      }
      if (isSortDropdownOpen && !sortDropdownRef.current?.contains(target)) {
        setIsSortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDropdownClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleDropdownClickOutside);
  }, [isProviderDropdownOpen, isSortDropdownOpen]);

  // Manage mount/unmount to animate open/close like BalanceDisplay transitions
  useEffect(() => {
    if (isModelDrawerOpen && isAuthenticated) {
      setIsDrawerVisible(true);
      // next frame to enable transition to visible
      const raf = requestAnimationFrame(() => setIsDrawerAnimating(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setIsDrawerAnimating(false);
      const timer = setTimeout(() => setIsDrawerVisible(false), 180);
      return () => clearTimeout(timer);
    }
  }, [isModelDrawerOpen, isAuthenticated]);

  // Handle search input keydown events
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent propagation to avoid closing the drawer
    e.stopPropagation();

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const lastIndex = visibleAllModelEntries.length - 1;
      if (lastIndex < 0) return;
      setHighlightedIndex((index) =>
        e.key === "ArrowDown"
          ? Math.min(index + 1, lastIndex)
          : Math.max(index - 1, 0)
      );
      return;
    }

    if (e.key === "Enter") {
      const model = visibleAllModelEntries[highlightedIndex];
      if (model && isModelAvailable(model, effectiveBalance)) {
        handleModelChange(model.id);
        setIsModelDrawerOpen(false);
      }
      e.preventDefault();
      return;
    }

    // Handle escape key to clear search
    if (e.key === "Escape") {
      setSearchQuery("");
      e.preventDefault();
    }
  };

  // Keep the keyboard-highlighted row in view
  useEffect(() => {
    if (highlightedIndex < 0) return;
    modelDrawerRef.current
      ?.querySelector(`[data-model-row="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const modalityIconFor = (key: string): ReactNode => {
    switch (key) {
      case "text":
        return <Type className="h-3.5 w-3.5" />;
      case "image":
        return <ImageIcon className="h-3.5 w-3.5" />;
      case "audio":
        return <Mic className="h-3.5 w-3.5" />;
      case "video":
        return <Video className="h-3.5 w-3.5" />;
      default:
        return <Type className="h-3.5 w-3.5" />;
    }
  };

  const renderCompanyRail = (orientation: "vertical" | "horizontal") => {
    const isVertical = orientation === "vertical";

    return (
      <div
        className={
          isVertical
            ? "flex h-full flex-col gap-1 overflow-y-auto overflow-x-hidden p-1.5 scrollbar-none"
            : "mt-2 flex gap-1 overflow-x-auto pb-1 sm:hidden scrollbar-none"
        }
      >
        {companyFilters.map((filter) => {
          const isActive = selectedCompany === filter.id;
          return (
            <button
              key={filter.id}
              onClick={() => {
                setSelectedCompany(filter.id);
                setHoveredModelId(null);
              }}
              className={
                isVertical
                  ? `group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-[10px] font-bold transition-all cursor-pointer ${
                      isActive
                        ? "border-primary/35 bg-primary/15 text-foreground shadow-e1"
                        : "border-transparent bg-transparent text-muted-foreground hover:border-border/45 hover:bg-muted/35 hover:text-foreground"
                    }`
                  : `inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? "border-primary/35 bg-primary/15 text-foreground"
                        : "border-border/55 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    }`
              }
              data-tooltip={isVertical ? filter.label : undefined}
              data-tooltip-side="inside-right"
              type="button"
              aria-pressed={isActive}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {renderCompanyIcon(filter.id, "h-4 w-4")}
              </span>
              {!isVertical && (
                <>
                  <span>{filter.shortLabel}</span>
                  <span className="text-[10px] text-muted-foreground/75">
                    {filter.count}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const renderScopeFilters = () => (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible">
        <button
          onClick={() => {
            setWebSearchFilter(false);
            setPrivateFilter(false);
            setImageFilter(false);
            setAvailableOnly(false);
            setSelectedProvider("all");
          }}
          disabled={!hasActiveModelFilters}
          className="shrink-0 rounded-full border border-border/60 bg-muted/20 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors cursor-pointer hover:bg-muted/45 hover:text-foreground disabled:cursor-default disabled:opacity-45 disabled:hover:bg-muted/20 disabled:hover:text-muted-foreground"
          data-tooltip={hasActiveModelFilters ? "Clear filters" : undefined}
          data-tooltip-side="bottom"
          type="button"
        >
          Reset
        </button>
        <button
          onClick={() => setAvailableOnly(!availableOnly)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            availableOnly
              ? "border-primary/35 bg-primary/15 text-foreground"
              : "border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          }`}
          data-tooltip="Fits your balance"
          data-tooltip-side="bottom"
          type="button"
          aria-pressed={availableOnly}
        >
          Can run
        </button>
        <button
          onClick={() => setWebSearchFilter(!webSearchFilter)}
          className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
            webSearchFilter
              ? "border-primary/35 bg-primary/15 text-foreground"
              : "border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          }`}
          data-tooltip="Models that can browse or search"
          data-tooltip-side="bottom"
          type="button"
          aria-pressed={webSearchFilter}
        >
          <Globe className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setImageFilter(!imageFilter)}
          className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
            imageFilter
              ? "border-primary/35 bg-primary/15 text-foreground"
              : "border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          }`}
          data-tooltip="Image generation models"
          data-tooltip-side="bottom"
          type="button"
          aria-pressed={imageFilter}
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setPrivateFilter(!privateFilter)}
          className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
            privateFilter
              ? "border-primary/35 bg-primary/15 text-foreground"
              : "border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          }`}
          data-tooltip="Private (end-to-end encrypted) models"
          data-tooltip-side="bottom"
          type="button"
          aria-pressed={privateFilter}
        >
          <Lock className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        {/* Provider dropdown */}
        <div className="relative min-w-0 flex-1" ref={providerDropdownRef}>
          <button
            onClick={() => {
              setIsProviderDropdownOpen(!isProviderDropdownOpen);
              setIsSortDropdownOpen(false);
            }}
            className="inline-flex h-8 w-full items-center justify-between gap-1.5 rounded-full border border-border/60 bg-background/55 px-2.5 text-xs font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted/35 hover:text-foreground cursor-pointer"
            aria-label="Filter by provider"
            type="button"
          >
            <span className="truncate">
              {selectedProvider === "all"
                ? "Providers"
                : providerOptions.find((p) => p.value === selectedProvider)
                    ?.label ?? "Providers"}
            </span>
            <ChevronDown
              className={`h-3 w-3 shrink-0 transition-transform ${isProviderDropdownOpen ? "rotate-180" : ""}`}
            />
          </button>
          {isProviderDropdownOpen && (
            <div className="absolute left-0 top-full mt-1 z-[120] w-[260px] max-w-[calc(100vw-120px)] max-h-[240px] overflow-y-auto rounded-xl border border-border/70 bg-popover shadow-e3 py-1 scrollbar-none">
              <button
                onClick={() => {
                  setSelectedProvider("all");
                  setIsProviderDropdownOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                  selectedProvider === "all"
                    ? "bg-primary/15 text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                }`}
                type="button"
              >
                <span className="block truncate">All providers</span>
              </button>
              {providerOptions.map((provider) => (
                <button
                  key={provider.value}
                  onClick={() => {
                    setSelectedProvider(provider.value);
                    setIsProviderDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                    selectedProvider === provider.value
                      ? "bg-primary/15 text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                  type="button"
                >
                  <span className="block truncate">{provider.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Sort dropdown */}
        <div className="relative" ref={sortDropdownRef}>
          <button
            onClick={() => {
              setIsSortDropdownOpen(!isSortDropdownOpen);
              setIsProviderDropdownOpen(false);
            }}
            className="inline-flex h-8 w-[104px] shrink-0 items-center justify-between gap-1.5 rounded-full border border-border/60 bg-background/55 px-2.5 text-xs font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted/35 hover:text-foreground cursor-pointer"
            aria-label="Sort models"
            type="button"
          >
            <span>
              {MODEL_SORT_OPTIONS.find((o) => o.value === sortMode)?.label ??
                "Smart"}
            </span>
            <ChevronDown
              className={`h-3 w-3 shrink-0 transition-transform ${isSortDropdownOpen ? "rotate-180" : ""}`}
            />
          </button>
          {isSortDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-xl border border-border/70 bg-popover shadow-e3 py-1">
              {MODEL_SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setSortMode(option.value);
                    setIsSortDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                    sortMode === option.value
                      ? "bg-primary/15 text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() =>
            setSortDirection((direction) =>
              direction === "desc" ? "asc" : "desc"
            )
          }
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
            sortDirection === "asc"
              ? "border-primary/30 bg-primary/15 text-foreground"
              : "border-border/60 bg-background/55 text-muted-foreground hover:bg-muted/35 hover:text-foreground"
          }`}
          data-tooltip="Reverse order"
          data-tooltip-side="bottom"
          type="button"
          aria-label="Reverse sort order"
          aria-pressed={sortDirection === "asc"}
        >
          <ArrowDownUp
            className={`h-3.5 w-3.5 transition-transform ${
              sortDirection === "asc" ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>
    </div>
  );

  // Shared search bar component
  const renderSearchBar = () => (
    <div className="sticky top-0 z-10 border-b border-border/70 bg-card/95 p-3 backdrop-blur-xl">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Models</div>
          <div className="text-[11px] text-muted-foreground">
            {uniqueModelCount > 0 && uniqueProviderCount > 0
              ? `${uniqueProviderCount} providers - priced in sats`
              : "Search configured providers"}
          </div>
        </div>
        {openModelsConfig && (
          <button
            onClick={() => openModelsConfig()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground"
            data-tooltip="Configure models"
            data-tooltip-side="bottom"
            type="button"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search models..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="h-10 w-full rounded-xl border border-border/70 bg-background/55 py-2 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground/70 shadow-inner focus:outline-none focus:ring-2 focus:ring-ring/25"
        />
        <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-2">
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              data-tooltip="Clear"
              data-tooltip-side="bottom"
              type="button"
            >
              <span className="text-xs">x</span>
            </button>
          )}
        </div>
      </div>
      {renderScopeFilters()}
      {renderCompanyRail("horizontal")}
    </div>
  );

  // Skeleton rows shaped like model items, shown only while the first fetch runs
  const renderLoadingState = () => (
    <div className="space-y-1 p-2" aria-busy="true" aria-label="Loading models">
      {[72, 58, 66, 48, 62, 54].map((width, index) => (
        <div
          key={index}
          className="flex animate-pulse items-center gap-3 rounded-xl border border-border/25 bg-card/20 p-3"
          style={{ animationDelay: `${index * 90}ms` }}
        >
          <div className="h-3.5 w-3.5 shrink-0 rounded bg-muted/60" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 rounded bg-muted/60" style={{ width: `${width}%` }} />
            <div className="h-2.5 rounded bg-muted/40" style={{ width: `${width / 2}%` }} />
          </div>
          <div className="h-5 w-14 shrink-0 rounded-full bg-muted/40" />
        </div>
      ))}
    </div>
  );

  const renderModelListSections = () => (
    <div className="model-selector-list slim-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2 pb-10 [scrollbar-gutter:stable]">
      {selectedModel && (
        <div className="p-1">
          <div className="px-2 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            Current
          </div>
          <div className="space-y-1">
            {renderModelItem(
              selectedModel,
              isConfiguredModel(selectedModel.id),
              currentProviderLabel,
              currentConfiguredKey
            )}
          </div>
        </div>
      )}

      {selectedModel && allModelEntries.length > 0 && (
        <div className="my-2 border-t border-border/60" />
      )}

      <div className="p-1">
        <div className="flex items-center justify-between gap-3 px-2 py-2">
          <div className="min-w-0 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            {activeCompanyFilterLabel}
            {selectedCompany === "all" &&
              uniqueModelCount > 0 &&
              uniqueProviderCount > 0 && (
                <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">
                  {selectedProvider !== "all"
                    ? `(${allModelEntries.length} on ${
                        providerOptions.find(
                          (provider) => provider.value === selectedProvider
                        )?.label ?? "this provider"
                      })`
                    : hasActiveModelFilters || deferredSearchQuery
                      ? `(${allModelEntries.length} of ${uniqueModelCount})`
                      : `(${uniqueModelCount} models from ${uniqueProviderCount} providers)`}
                </span>
              )}
          </div>
          {deferredSearchQuery && (
            <div className="shrink-0 text-[10px] font-semibold text-muted-foreground/60">
              {allModelEntries.length} matches
            </div>
          )}
        </div>

        {allModelEntries.length > 0 ? (
          <div className="space-y-1">
            {visibleAllModelEntries.map((model, index) =>
              renderModelItem(
                model,
                selectedCompany === "favorites",
                undefined,
                undefined,
                index
              )
            )}
            {hiddenModelCount > 0 && (
              <LoadMoreSentinel
                hiddenCount={hiddenModelCount}
                onLoadMore={handleLoadMore}
              />
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-5 text-center">
            {selectedCompany === "favorites" && (
              <Star className="mx-auto mb-2 h-5 w-5 text-muted-foreground/40" />
            )}
            <div className="text-xs font-medium text-muted-foreground/60">
              {selectedCompany === "favorites"
                ? "Star models to add them here"
                : deferredSearchQuery
                  ? `No models match "${deferredSearchQuery}"`
                  : "No models match the current filters"}
            </div>
            {selectedCompany !== "favorites" &&
              (deferredSearchQuery ||
                imageFilter ||
                webSearchFilter ||
                privateFilter ||
                availableOnly ||
                selectedProvider !== "all" ||
                selectedCompany !== "all") && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setWebSearchFilter(false);
                    setPrivateFilter(false);
                    setImageFilter(false);
                    setAvailableOnly(false);
                    setSelectedProvider("all");
                    setSelectedCompany("all");
                  }}
                  className="mt-3 inline-flex h-7 items-center rounded-full border border-border/60 bg-muted/30 px-3 text-[11px] font-semibold text-muted-foreground transition-colors cursor-pointer hover:bg-muted hover:text-foreground"
                  type="button"
                >
                  Clear search & filters
                </button>
              )}
          </div>
        )}
      </div>
    </div>
  );

  // Render a model item
  const renderModelItem = (
    model: Model,
    isFavorite: boolean = false,
    providerLabel?: string,
    configuredKeyOverride?: string,
    rowIndex?: number
  ) => {
    // Resolve provider base for this item (fixed provider wins; otherwise use best-priced mapping)
    const isFixedProvider =
      !!configuredKeyOverride && configuredKeyOverride.includes("@@");
    const fixedBaseRaw = isFixedProvider
      ? parseModelKey(configuredKeyOverride!).base
      : null;
    const fixedBase = normalizeBaseUrl(fixedBaseRaw);
    const mappedBase = normalizeBaseUrl(modelProviderMap[model.id]);
    const baseForPricing = fixedBase || mappedBase;
    const providerModels = baseForPricing
      ? providerModelCache[baseForPricing]
      : undefined;
    const providerSpecificModel = providerModels
      ? providerModels[model.id]
      : undefined;
    const effectiveModelForPricing = providerSpecificModel || model;
    const providerCount = isFixedProvider
      ? 0
      : getProviderPricingEntries(model.id).length;
    const isAvailable = isModelAvailable(effectiveModelForPricing, effectiveBalance);
    const requiredMin = getRequiredSatsForModel(effectiveModelForPricing);
    const isFav = isFavorite || isConfiguredModel(model.id);
    const favoriteKeysForModel = configuredModels.filter(
      (key) => parseModelKey(key).id === model.id
    );
    const effectiveProviderLabel =
      providerLabel || formatProviderLabel(baseForPricing, model);
    const isDynamicProvider = !isFixedProvider;
    // Selection should be provider+model specific when provider is fixed
    const idMatches = selectedModel?.id === model.id;
    const itemBaseForSelection = baseForPricing || null;
    const providerMatches = isFixedProvider
      ? Boolean(
          currentSelectedBaseUrl &&
          itemBaseForSelection &&
          currentSelectedBaseUrl === itemBaseForSelection
        )
      : true;
    const isSelectedItem = Boolean(idMatches && providerMatches);
    return (
      <div
        key={`${configuredKeyOverride || model.id}`}
        data-model-row={rowIndex}
        style={
          rowIndex !== undefined
            ? { animationDelay: `${Math.min(rowIndex % MODEL_RENDER_INCREMENT, 12) * 18}ms` }
            : undefined
        }
        className={`${
          isAvailable ? "model-item-in " : ""
        }group/model min-w-0 p-3 text-xs rounded-xl border transition-all duration-150 ${
          !isAvailable
            ? "opacity-45 cursor-not-allowed border-border/20 bg-muted/10"
            : isSelectedItem
              ? "bg-primary/[0.08] border-primary/30 shadow-e1 cursor-pointer font-semibold"
              : model.id === hoveredModelId
                ? // Persistent cue for the row the details pane is describing;
                  // plain :hover vanishes once the cursor moves to the pane.
                  "bg-muted/60 border-border shadow-e1 cursor-pointer"
                : "bg-card/25 hover:bg-muted/35 hover:border-border/70 hover:shadow-e1 border-border/35 cursor-pointer"
        } ${
          rowIndex !== undefined && rowIndex === highlightedIndex
            ? "ring-2 ring-ring/40"
            : ""
        }`}
        onMouseEnter={() => setHoveredModelId(model.id)}
      >
        <div className="flex min-w-0 items-center gap-3">
          {/* Favorite toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isFav) {
                const keysToRemove =
                  favoriteKeysForModel.length > 0
                    ? favoriteKeysForModel
                    : [configuredKeyOverride || model.id];
                keysToRemove.forEach((key) => toggleConfiguredModel(key));
                return;
              }

              toggleConfiguredModel(configuredKeyOverride || model.id);
            }}
            className={`shrink-0 rounded-lg border border-transparent p-1 transition-colors cursor-pointer group-hover/model:border-border/40 group-hover/model:bg-muted/30 ${
              isFav
                ? "text-yellow-500 hover:text-yellow-400"
                : "text-muted-foreground hover:text-yellow-500"
            }`}
            data-tooltip={isFav ? "Remove from favorites" : "Add to favorites"}
            data-tooltip-side="right"
            type="button"
          >
            <Star className={`h-3.5 w-3.5 ${isFav ? "fill-current" : ""}`} />
          </button>
          {/* Model Info - Clickable area for selection */}
          <div
            className={`flex-1 min-w-0 ${
              isAvailable ? "cursor-pointer" : "cursor-not-allowed"
            }`}
            aria-disabled={!isAvailable}
            onClick={() => {
              if (isAvailable) {
                // If this is a favorite with a fixed provider, persist mapping so selection is fixed
                if (isFixedProvider && fixedBase && setModelProviderFor) {
                  setModelProviderFor(model.id, fixedBase);
                }
                handleModelChange(model.id, configuredKeyOverride || undefined);
                setIsModelDrawerOpen(false);
              }
            }}
          >
            <div className="flex items-center gap-1.5 truncate font-semibold text-foreground">
              <span className="truncate">
                {getModelNameWithoutProvider(model.name)}
              </span>
              {isSelectedItem && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
              {!isAvailable && requiredMin > 0 && (
                <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium shrink-0">
                  {requiredMin < 1
                    ? "Min: <1 sat"
                    : `Min: ${Math.round(requiredMin)} sats`}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1 pr-2 text-muted-foreground">
                {isDynamicProvider && (
                  <span
                    data-tooltip="Auto-picks cheapest provider"
                    data-tooltip-side="inside-right"
                  >
                    ~
                  </span>
                )}
                <span className="min-w-0 truncate">{effectiveProviderLabel}</span>
                {isDynamicProvider && (
                  <span
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
                    data-tooltip="Auto-picks cheapest provider"
                    data-tooltip-side="inside-right"
                  >
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </span>
                )}
                {providerCount > 1 && (
                  <span
                    className="shrink-0 rounded-full border border-border/40 bg-muted/30 px-1.5 py-px text-[10px] text-muted-foreground/80"
                    data-tooltip="Available from multiple providers"
                    data-tooltip-side="inside-right"
                  >
                    +{providerCount - 1}
                  </span>
                )}
              </span>
              <span
                className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-border/40 bg-muted/25 px-2 py-1"
                data-tooltip={(() => {
                  const completion =
                    effectiveModelForPricing?.sats_pricing?.completion;
                  return getPricingIndex(completion) === null
                    ? "Price unavailable"
                    : `~${formatSatsPer1M(completion)} (fewer icons = cheaper)`;
                })()}
                data-tooltip-side="left"
              >
                {(() => {
                  const value = getPricingIndex(
                    effectiveModelForPricing?.sats_pricing?.completion
                  );
                  if (value === null)
                    return (
                      <span className="text-[10px] text-muted-foreground/60">
                        no price
                      </span>
                    );
                  const fullCount = Math.floor(value);
                  const hasHalf =
                    value - fullCount >= 0.3 && value - fullCount < 0.8;
                  const emptyCount =
                    5 -
                    fullCount -
                    (hasHalf ? 1 : 0) -
                    (value - fullCount >= 0.8 ? 1 : 0);
                  const extraFull = value - fullCount >= 0.8 ? 1 : 0;

                  return (
                    <>
                      {/* Full yellow icons */}
                      {Array.from({ length: fullCount + extraFull }, (_, i) => (
                        <Bitcoin
                          key={`full-${i}`}
                          className="h-3 w-3 text-yellow-500 -ml-0.5 first:ml-0"
                        />
                      ))}
                      {/* Half icon */}
                      {hasHalf && (
                        <span className="relative w-3 h-3 overflow-hidden -ml-0.5">
                          <Bitcoin className="h-3 w-3 text-muted-foreground/15 absolute" />
                          <span
                            className="absolute inset-0 overflow-hidden"
                            style={{ width: "50%" }}
                          >
                            <Bitcoin className="h-3 w-3 text-yellow-500" />
                          </span>
                        </span>
                      )}
                      {/* Empty gray icons */}
                      {Array.from({ length: emptyCount }, (_, i) => (
                        <Bitcoin
                          key={`empty-${i}`}
                          className="h-3 w-3 text-muted-foreground/15 -ml-0.5"
                        />
                      ))}
                    </>
                  );
                })()}
              </span>
            </div>
          </div>

          {/* Mobile: Details view navigation trigger */}
          {isMobile && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Resolve base for details as well so the details panel fetches correct pricing
                setDetailsModel(model);
                setDetailsBaseUrl(baseForPricing);
                navigateToView("details");
              }}
              className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
              data-tooltip="View details"
              data-tooltip-side="left"
              type="button"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Render model details (shared by desktop pane and mobile popover)
  const renderModelDetails = (model: Model) => {
    const providerPricingEntries = getProviderPricingEntries(model.id);
    // "Current" only applies when this details pane describes the model the
    // chat is actually on. Without this, every model's details tagged the
    // app's global provider as "current".
    const isCurrentModel = !!selectedModel && selectedModel.id === model.id;
    // Provider context for the header/pricing, in priority order: a provider
    // row the user clicked, the provider the chat is on (selected model only),
    // then the cheapest mapping (what a click would select).
    const baseForDetails =
      normalizeBaseUrl(detailsBaseUrl) ||
      (isCurrentModel && currentSelectedBaseUrl
        ? normalizeBaseUrl(currentSelectedBaseUrl)
        : null) ||
      normalizeBaseUrl(modelProviderMap[model.id]);
    const providerModels = baseForDetails
      ? providerModelCache[baseForDetails]
      : undefined;
    const providerSpecificModel = providerModels
      ? providerModels[model.id]
      : undefined;
    // Describe the entry a click would actually select: the one matching the
    // resolved provider context, else the cheapest.
    const entryForDetails =
      (baseForDetails
        ? providerPricingEntries.find(
            (entry) => entry.baseUrl === baseForDetails
          )
        : undefined) ?? providerPricingEntries[0];
    const effectiveModel = providerSpecificModel || entryForDetails?.model || model;
    const providerLabel = baseForDetails
      ? formatProviderLabel(baseForDetails, effectiveModel)
      : entryForDetails?.providerLabel ??
        formatProviderLabel(baseForDetails, effectiveModel);
    const cheapestBaseUrl = providerPricingEntries[0]?.baseUrl ?? null;
    const mappedCheapestBase = normalizeBaseUrl(modelProviderMap[model.id]);
    // Deltas are always relative to the #1 cheapest entry so they can never
    // contradict the sort order (baselining on "current" made pricier rows
    // show green negative numbers whenever the baseline wasn't #1).
    const cheapestCompletionCost =
      providerPricingEntries[0]?.completionCost ?? null;

    const formatPercentDelta = (
      entryCost: number | null,
      baselineCost: number | null
    ): string | null => {
      if (
        entryCost === null ||
        baselineCost === null ||
        !isFinite(entryCost) ||
        !isFinite(baselineCost) ||
        baselineCost <= 0
      )
        return null;
      const diff = ((entryCost - baselineCost) / baselineCost) * 100;
      const rounded = Math.round(diff * 10) / 10;
      const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
      return `${sign}${Math.abs(rounded).toFixed(1)}%`;
    };

    // Date formatter for created timestamp (epoch seconds)
    const formatDate = (epochSeconds?: number): string => {
      try {
        if (
          typeof epochSeconds !== "number" ||
          !isFinite(epochSeconds) ||
          epochSeconds <= 0
        )
          return "-";
        const d = new Date(epochSeconds * 1000);
        if (isNaN(d.getTime())) return "-";
        return d.toLocaleDateString();
      } catch {
        return "-";
      }
    };

    // Build input->output modality pairs for icon display
    const inputs = new Set(
      (effectiveModel?.architecture?.input_modalities ?? ["text"]).map(
        normalizeModality
      )
    );
    const outputs = new Set(
      (effectiveModel?.architecture?.output_modalities ?? ["text"]).map(
        normalizeModality
      )
    );
    const ioPairs: { key: string; input: string; output: string }[] = (() => {
      const pairs: { key: string; input: string; output: string }[] = [];
      const seen = new Set<string>();
      for (const i of inputs) {
        for (const o of outputs) {
          const key = `${i}->${o}`;
          if (!seen.has(key)) {
            seen.add(key);
            pairs.push({ key, input: i, output: o });
          }
        }
      }
      return pairs;
    })();

    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              {(() => {
                // Skip the literal "Unknown" fallback for names without a
                // company prefix; the provider host is enough on its own.
                const company = getProviderFromModelName(effectiveModel.name);
                const hasCompany = company !== "Unknown";
                return (
                  <>
                    {hasCompany && <span>{company}</span>}
                    {providerLabel && providerLabel !== company && (
                      <>
                        {hasCompany && (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                        <span>{providerLabel}</span>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="text-base font-semibold truncate text-foreground">
              {getModelNameWithoutProvider(effectiveModel.name)}
            </div>
            <div className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-2">
              <span
                className="break-all"
                data-tooltip="Model ID"
                data-tooltip-side="bottom"
              >
                {effectiveModel.id}
              </span>
              <button
                onClick={() => {
                  try {
                    void navigator.clipboard.writeText(effectiveModel.id);
                    setCopiedModelId(effectiveModel.id);
                    setTimeout(() => setCopiedModelId(null), 1200);
                  } catch {}
                }}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
                data-tooltip="Copy model ID"
                data-tooltip-side="bottom"
                type="button"
                aria-label="Copy model ID"
              >
                {copiedModelId === effectiveModel.id ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
              {effectiveModel.created ? (
                <span className="whitespace-nowrap">
                  - {formatDate(effectiveModel.created)}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {effectiveModel.description && (
          <div className="text-xs text-muted-foreground line-clamp-4">
            {effectiveModel.description}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
            <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
              Context length
            </div>
            <div className="font-semibold mt-1 text-foreground">
              {effectiveModel.context_length?.toLocaleString?.() ?? "-"} tokens
            </div>
          </div>
          <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
            <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
              Modality
            </div>
            <div className="font-semibold mt-1 text-foreground animate-in fade-in duration-200">
              <div className="flex flex-wrap gap-1.5">
                {ioPairs.length > 0 ? (
                  ioPairs.map((p) => (
                    <span
                      key={p.key}
                      className="inline-flex items-center gap-0.5"
                      data-tooltip={`${p.input} to ${p.output}`}
                      data-tooltip-side="bottom"
                    >
                      {modalityIconFor(p.input)}
                      <span>-&gt;</span>
                      {modalityIconFor(p.output)}
                    </span>
                  ))
                ) : (
                  <span>-</span>
                )}
              </div>
            </div>
          </div>
          <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
            <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
              Tokenizer
            </div>
            <div className="font-semibold mt-1 text-foreground truncate">
              {effectiveModel.architecture?.tokenizer ?? "-"}
            </div>
          </div>
          <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
            <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
              Instruct type
            </div>
            <div className="font-semibold mt-1 text-foreground truncate">
              {effectiveModel.architecture?.instruct_type ?? "-"}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-muted-foreground">
            Pricing
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
              <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
                Prompt
              </div>
              <div className="font-semibold mt-1 text-foreground">
                {formatSatsPer1M(effectiveModel?.sats_pricing?.prompt)}
              </div>
            </div>
            <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
              <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
                Completion
              </div>
              <div className="font-semibold mt-1 text-foreground">
                {formatSatsPer1M(effectiveModel?.sats_pricing?.completion)}
              </div>
            </div>
          </div>
          {(() => {
            // Hide the estimate when provider pricing is missing or garbage
            // (some community providers report negative costs).
            if (!effectiveModel?.sats_pricing) return null;
            const estMin = getRequiredSatsForModel(effectiveModel);
            if (!isFinite(estMin) || estMin <= 0) return null;
            return (
              <div className="text-[10px] font-medium text-muted-foreground/80 pl-1">
                Est. min: {estMin < 1 ? "<1 sat" : `${Math.round(estMin)} sats`}
              </div>
            );
          })()}
        </div>

        {providerPricingEntries.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              Provider cost comparison
            </div>
            <div className="space-y-1">
              {providerPricingEntries.map((entry, index) => {
                const isActive =
                  isCurrentModel &&
                  currentSelectedBaseUrl &&
                  normalizeBaseUrl(currentSelectedBaseUrl) === entry.baseUrl;
                const isCheapest =
                  cheapestBaseUrl && entry.baseUrl === cheapestBaseUrl;
                const isDefaultCheapest =
                  isCheapest &&
                  mappedCheapestBase &&
                  mappedCheapestBase === entry.baseUrl;
                const isSelected = isActive || isDefaultCheapest;
                const percentDelta =
                  index === 0
                    ? null
                    : formatPercentDelta(
                        entry.completionCost,
                        cheapestCompletionCost
                      );
                return (
                  <button
                    key={entry.baseUrl}
                    onClick={() => selectProviderForModel(model, entry.baseUrl)}
                    type="button"
                    className={`w-full text-left rounded-xl border px-2.5 py-1.5 text-[11px] transition-colors cursor-pointer ${
                      isSelected
                        ? "border-primary/25 bg-primary/[0.07] shadow-sm font-medium"
                        : "border-border/40 bg-muted/15 hover:bg-muted/35 hover:border-border/80"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center justify-center h-4 min-w-[18px] px-1 rounded-full bg-muted text-[9px] text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span className="font-medium truncate">
                        {entry.providerLabel}
                      </span>
                      {isCheapest && (
                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                          cheapest
                        </span>
                      )}
                      {isActive && (
                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-primary/15 text-primary">
                          current
                        </span>
                      )}
                      {!isActive && isDefaultCheapest && (
                        <span className="text-[9px] px-1 py-0.5 rounded-full bg-muted text-muted-foreground">
                          default
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground/80 flex flex-wrap gap-2">
                      <span>
                        P: {formatSatsPer1M(entry.promptCost ?? undefined)}
                      </span>
                      <span>
                        C: {formatSatsPer1M(entry.completionCost ?? undefined)}
                      </span>
                      {percentDelta && (
                        <span className="text-amber-600 dark:text-amber-400">
                          {percentDelta}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Capabilities section removed per request */}
      </div>
    );
  };

  return (
    <div className="relative">
      <button
        ref={toggleButtonRef}
        onClick={(e) => {
          e.stopPropagation();
          if (isAuthenticated) {
            setIsModelDrawerOpen(!isModelDrawerOpen);
          } else {
            setIsLoginModalOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isAuthenticated) {
              setIsModelDrawerOpen(!isModelDrawerOpen);
            } else {
              setIsLoginModalOpen(true);
            }
          }
        }}
        aria-expanded={isModelDrawerOpen}
        aria-controls="model-selector-drawer"
        className={`flex h-[40px] items-center gap-2 overflow-hidden rounded-2xl border bg-card/55 px-4 py-2 text-sm font-semibold text-foreground shadow-e1 backdrop-blur-md transition-all duration-200 cursor-pointer max-w-[calc(100vw-260px)] hover:bg-muted/55 hover:shadow-e2 sm:max-w-none ${
          lowBalanceWarningForModel
            ? "border-destructive/80 ring-1 ring-destructive/30"
            : "border-border/60"
        }`}
        data-tutorial="model-selector"
        type="button"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate whitespace-nowrap font-semibold">
            {selectedModel
              ? getModelNameWithoutProvider(selectedModel.name)
              : isWalletLoading
                ? "Loading"
                : "Select Model"}
          </span>
          {lowBalanceWarningForModel && !isWalletLoading && (
            <span className="text-red-600 dark:text-red-400 text-[10px] font-medium whitespace-nowrap">
              low balance
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${
            isModelDrawerOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isDrawerVisible && isAuthenticated && (
        <div
          ref={modelDrawerRef}
          id="model-selector-drawer"
          className={`${
            isMobile
              ? "fixed left-1/2 -translate-x-1/2 top-[64px] w-[94vw]"
              : "absolute top-full left-0 w-[820px] max-w-[95vw] mt-2"
          } bg-popover border border-border/80 rounded-2xl shadow-e3 max-h-[76vh] overflow-hidden z-50 transform transition-all duration-200 ${
            isDrawerAnimating
              ? "opacity-100 translate-y-0 scale-100"
              : "opacity-0 -translate-y-1 scale-95"
          }`}
          onMouseLeave={() => setHoveredModelId(null)}
        >
          {/* Mobile view: page-like transition between list and details */}
          <div
            className={`sm:hidden transition-all duration-300 ${
              isTransitioning
                ? "opacity-0 translate-x-2"
                : "opacity-100 translate-x-0"
            } slim-scroll overflow-y-auto max-h-[70vh]`}
          >
            {activeView === "list" ? (
              <div>
                {renderSearchBar()}
                {isLoadingModels && dedupedModels.length === 0
                  ? renderLoadingState()
                  : renderModelListSections()}
              </div>
            ) : (
              <div className="p-3 space-y-3">
                <button
                  onClick={() => navigateToView("list")}
                  className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  type="button"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                {detailsModel ? (
                  <div className="space-y-3">
                    {renderModelDetails(detailsModel)}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No model selected
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Desktop view: side-by-side list and details */}
          <div className="hidden sm:grid h-[76vh] max-h-[76vh] overflow-hidden grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
            {/* Left: Search + List */}
            <div className="grid min-h-0 h-full max-h-full grid-cols-[48px_minmax(0,1fr)] border-r border-border/70">
              <div className="border-r border-border/60 bg-background/20 h-full max-h-full overflow-hidden">
                {renderCompanyRail("vertical")}
              </div>
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                {renderSearchBar()}
                {isLoadingModels && dedupedModels.length === 0
                  ? renderLoadingState()
                  : renderModelListSections()}
              </div>
            </div>

            {/* Right: Details */}
            <div className="slim-scroll h-full min-h-0 overflow-y-auto overflow-x-hidden bg-background/20 p-4 [scrollbar-gutter:stable]">
              {previewModel ? (
                renderModelDetails(previewModel)
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <Search className="h-5 w-5 text-muted-foreground/40" />
                  <div className="text-sm font-medium text-muted-foreground">
                    Hover a model to preview it
                  </div>
                  <div className="text-xs text-muted-foreground/60">
                    Pricing, context window and providers show up here
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
