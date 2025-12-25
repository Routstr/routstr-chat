import { useRef, useEffect, useState, useMemo } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  Settings,
  Star,
  Info,
  Image as ImageIcon,
  Type,
  Mic,
  Video,
  Copy,
  Check,
  Globe,
} from "lucide-react";
import type { ReactNode } from "react";
import { Model } from "@/types/models";
import {
  getModelNameWithoutProvider,
  getProviderFromModelName,
} from "@/utils/modelUtils";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useCashuWithXYZ } from "@/hooks/useCashuWithXYZ";
import {
  loadModelProviderMap,
  loadDisabledProviders,
} from "@/utils/storageUtils";
import {
  parseModelKey,
  normalizeBaseUrl,
  upsertCachedProviderModels,
  getCachedProviderModels,
  getRequiredSatsForModel,
  isModelAvailable,
} from "@/utils/modelUtils";
import { recommendedModels, webSearchModels } from "@/lib/preconfiguredModels";

interface ModelSelectorProps {
  selectedModel: Model | null;
  isModelDrawerOpen: boolean;
  setIsModelDrawerOpen: (isOpen: boolean) => void;
  isAuthenticated: boolean;
  setIsLoginModalOpen: (isOpen: boolean) => void;
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

export default function ModelSelector({
  selectedModel,
  isModelDrawerOpen,
  setIsModelDrawerOpen,
  isAuthenticated,
  setIsLoginModalOpen,
  isLoadingModels,
  filteredModels: models,
  handleModelChange,
  balance,
  configuredModels,
  openModelsConfig,
  toggleConfiguredModel,
  setModelProviderFor,
  baseUrl,
  lowBalanceWarningForModel,
}: ModelSelectorProps) {
  const modelDrawerRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [activeView, setActiveView] = useState<"list" | "details">("list");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [detailsModel, setDetailsModel] = useState<Model | null>(null);
  const [modelProviderMap, setModelProviderMap] = useState<
    Record<string, string>
  >({});
  const [providerModelCache, setProviderModelCache] = useState<
    Record<string, Record<string, Model>>
  >({});
  const [loadingProviderBases, setLoadingProviderBases] = useState<Set<string>>(
    new Set()
  );
  const [detailsBaseUrl, setDetailsBaseUrl] = useState<string | null>(null);
  const [pairFilters, setPairFilters] = useState<Set<string>>(new Set());
  const [webSearchFilter, setWebSearchFilter] = useState<boolean>(false);
  const [copiedModelId, setCopiedModelId] = useState<string | null>(null);
  // Drawer open/close animation state
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isDrawerAnimating, setIsDrawerAnimating] = useState(false);

  const { isWalletLoading } = useCashuWithXYZ();

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
  }, [models]);

  // Helpers to parse provider-qualified keys (moved to utils)

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

  // Determine which provider bases we likely need and prefetch them
  const neededProviderBases: readonly string[] = useMemo(() => {
    const bases = new Set<string>();
    try {
      // From configured favorites (keys may include @@base)
      for (const key of configuredModels) {
        const { base } = parseModelKey(key);
        const norm = normalizeBaseUrl(base);
        if (norm) bases.add(norm);
      }
      // From best-priced mapping for models in view
      for (const m of models) {
        const mapped = normalizeBaseUrl(modelProviderMap[m.id]);
        if (mapped) bases.add(mapped);
      }
      // From current selection key
      if (currentConfiguredKeyMemo) {
        const { base } = parseModelKey(currentConfiguredKeyMemo);
        const norm = normalizeBaseUrl(base);
        if (norm) bases.add(norm);
      }
      // From details panel selection
      if (detailsBaseUrl) {
        const norm = normalizeBaseUrl(detailsBaseUrl);
        if (norm) bases.add(norm);
      }
    } catch {}
    return Array.from(bases);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    configuredModels,
    models,
    modelProviderMap,
    currentConfiguredKeyMemo,
    detailsBaseUrl,
  ]);

  // Deduplicate models across providers by picking the best-priced variant per id
  const dedupedModels = useMemo(() => {
    const bestById = new Map<string, Model>();
    for (const m of models) {
      const existing = bestById.get(m.id);
      if (!existing) {
        bestById.set(m.id, m);
        continue;
      }
      const currentCost = m?.sats_pricing?.completion ?? 0;
      const existingCost = existing?.sats_pricing?.completion ?? 0;
      if (currentCost < existingCost) {
        bestById.set(m.id, m);
      }
    }
    return Array.from(bestById.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

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

  // Collect available input->output pairs dynamically from real model data
  const availablePairs: readonly {
    key: string;
    input: string;
    output: string;
  }[] = useMemo(() => {
    const found = new Map<
      string,
      { key: string; input: string; output: string }
    >();
    for (const m of dedupedModels) {
      try {
        const inputs = new Set(
          (m.architecture?.input_modalities ?? ["text"]).map(normalizeModality)
        );
        const outputs = new Set(
          (m.architecture?.output_modalities ?? ["text"]).map(normalizeModality)
        );
        for (const i of inputs) {
          for (const o of outputs) {
            const key = `${i}->${o}`;
            if (!found.has(key)) found.set(key, { key, input: i, output: o });
          }
        }
      } catch {}
    }
    return Array.from(found.values()).sort((a, b) =>
      a.key.localeCompare(b.key)
    );
  }, [dedupedModels]);

  // Filter models based on search query, selected input->output pair filters, and web search filter
  const filteredModels = dedupedModels.filter((model) => {
    const matchesSearch = getModelNameWithoutProvider(model.name)
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    // Apply web search filter
    if (webSearchFilter && !webSearchModels.includes(model.id)) {
      return false;
    }

    if (pairFilters.size === 0) return true;
    const inputs = new Set(
      (model.architecture?.input_modalities ?? ["text"]).map(normalizeModality)
    );
    const outputs = new Set(
      (model.architecture?.output_modalities ?? ["text"]).map(normalizeModality)
    );
    for (const i of inputs) {
      for (const o of outputs) {
        const key = `${i}->${o}`;
        if (pairFilters.has(key)) return true;
      }
    }
    return false;
  });

  // Determine which model's details to show in the right pane
  const previewModel: Model | null = useMemo(() => {
    const fromHover = filteredModels.find((m) => m.id === hoveredModelId);
    if (fromHover) return fromHover;
    if (selectedModel && filteredModels.some((m) => m.id === selectedModel.id))
      return selectedModel as Model;
    return filteredModels[0] ?? null;
  }, [filteredModels, hoveredModelId, selectedModel]);

  // Display helpers: convert sats/token -> tokens/sat
  const computeTokensPerSat = (satsPerToken?: number): number | null => {
    if (
      typeof satsPerToken !== "number" ||
      !isFinite(satsPerToken) ||
      satsPerToken <= 0
    )
      return null;
    return 1 / satsPerToken;
  };

  const formatTokensPerSat = (satsPerToken?: number): string => {
    const value = computeTokensPerSat(satsPerToken);
    if (value === null) return "—";
    if (value >= 1000) return `${Math.round(value).toLocaleString()} token/sat`;
    return `${value.toFixed(2)} token/sat`;
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

  // Treat a model as configured if any configured key matches its id or `${id}@@...`
  const isConfiguredModel = (modelId: string) => {
    return configuredModels.some(
      (key) => key === modelId || key.startsWith(`${modelId}@@`)
    );
  };

  // Split into configured and all (remaining) models
  const configuredModelsList = filteredModels.filter((model) =>
    isConfiguredModel(model.id)
  );
  const remainingModelsList = filteredModels.filter(
    (model) => !isConfiguredModel(model.id)
  );
  const recommendedModelsList = recommendedModels
    .map((modelId) => filteredModels.find((model) => model.id === modelId))
    .filter((model): model is Model => model !== undefined);

  // Calculate unique models and providers for display (excluding disabled providers)
  const { uniqueModelCount, uniqueProviderCount } = useMemo(() => {
    const disabledProviders = loadDisabledProviders();
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
  }, [dedupedModels, modelProviderMap]);

  // Build favorites entries with provider labels from configured keys
  const favoriteEntries = useMemo(() => {
    return configuredModels
      .map((key) => {
        const { id, base } = parseModelKey(key);
        let model = filteredModels.find((m) => m.id === id);
        if (!model && base) {
          try {
            const cached = getCachedProviderModels(base);
            if (cached) {
              model = cached.find((m) => m.id === id);
            }
          } catch {}
        }
        if (!model) return null;
        const mappedBase =
          base || modelProviderMap[key] || modelProviderMap[id];
        const providerLabel = formatProviderLabel(mappedBase, model);
        return { key, model, providerLabel } as {
          key: string;
          model: Model;
          providerLabel: string;
        };
      })
      .filter(
        (e): e is { key: string; model: Model; providerLabel: string } => !!e
      );
  }, [configuredModels, filteredModels, modelProviderMap]);

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

    // Handle escape key to clear search
    if (e.key === "Escape") {
      setSearchQuery("");
      e.preventDefault();
    }
  };

  // Quick filter badges for input->output pairs (from real data)
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

  const quickPairOptions: {
    key: string;
    input: string;
    output: string;
    label: string;
    left: ReactNode;
    right: ReactNode;
  }[] = useMemo(() => {
    return availablePairs.map((p) => ({
      key: p.key,
      input: p.input,
      output: p.output,
      label: `${p.input.charAt(0).toUpperCase() + p.input.slice(1)} → ${
        p.output.charAt(0).toUpperCase() + p.output.slice(1)
      }`,
      left: modalityIconFor(p.input),
      right: modalityIconFor(p.output),
    }));
  }, [availablePairs]);

  const togglePairFilter = (key: string) => {
    setPairFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderQuickFilters = () => (
    <div className="mt-2 -mx-2 px-2">
      <div className="flex gap-1.5 flex-wrap overflow-x-hidden pb-1 pr-2">
        {/* Web Search Filter */}
        <button
          onClick={() => setWebSearchFilter(!webSearchFilter)}
          className={`shrink-0 h-6 inline-flex items-center gap-1 px-2 rounded-full text-[11px] border transition-colors cursor-pointer ${
            webSearchFilter
              ? "bg-primary/20 border-primary/30 text-foreground"
              : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
          }`}
          title="Filter web search models"
          type="button"
          aria-pressed={webSearchFilter}
        >
          <Globe className="h-3.5 w-3.5" />
          <span>Web Search</span>
        </button>

        {quickPairOptions.map((opt) => {
          const isActive = pairFilters.has(opt.key);
          return (
            <button
              key={opt.key}
              onClick={() => togglePairFilter(opt.key)}
              className={`shrink-0 h-6 inline-flex items-center gap-1 px-2 rounded-full text-[11px] border transition-colors cursor-pointer ${
                isActive
                  ? "bg-primary/20 border-primary/30 text-foreground"
                  : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
              }`}
              title={`Filter by ${opt.label.toLowerCase()}`}
              type="button"
              aria-pressed={isActive}
            >
              <span className="inline-flex items-center gap-1">
                {opt.left}
                <span>→</span>
                {opt.right}
              </span>
              {/* icons only */}
            </button>
          );
        })}
        {(pairFilters.size > 0 || webSearchFilter) && (
          <button
            onClick={() => {
              setPairFilters(new Set());
              setWebSearchFilter(false);
            }}
            className="shrink-0 h-6 text-[11px] px-2 rounded-full bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted border border-border cursor-pointer"
            title="Clear filters"
            type="button"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );

  // Render a model item
  const renderModelItem = (
    model: Model,
    isFavorite: boolean = false,
    providerLabel?: string,
    configuredKeyOverride?: string
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
    const isAvailable = isModelAvailable(effectiveModelForPricing, balance);
    const requiredMin = getRequiredSatsForModel(effectiveModelForPricing);
    const isFav = isFavorite || isConfiguredModel(model.id);
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
        className={`p-2 text-sm rounded-md transition-colors ${
          !isAvailable
            ? "opacity-40 cursor-not-allowed"
            : isSelectedItem
              ? "bg-muted cursor-pointer"
              : "hover:bg-muted/50 cursor-pointer"
        }`}
        onMouseEnter={() => setHoveredModelId(model.id)}
      >
        <div className="flex items-center gap-2">
          {/* Favorite toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleConfiguredModel(configuredKeyOverride || model.id);
            }}
            className={`flex-shrink-0 p-0.5 rounded transition-colors cursor-pointer ${
              isFav
                ? "text-yellow-500 hover:text-yellow-400"
                : "text-muted-foreground hover:text-yellow-500"
            }`}
            title={isFav ? "Remove from favorites" : "Add to favorites"}
            type="button"
          >
            <Star className={`h-3 w-3 ${isFav ? "fill-current" : ""}`} />
          </button>
          {/* Model Info - Clickable area for selection */}
          <div
            className="flex-1 min-w-0 cursor-pointer"
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
            <div className={`font-medium truncate`}>
              {getModelNameWithoutProvider(model.name)}
            </div>
            <div className="text-xs text-muted-foreground flex items-center justify-between">
              <span className="text-muted-foreground truncate pr-2 flex items-center gap-1">
                {isDynamicProvider && (
                  <span title="Dynamic provider: always picks the cheapest based on pricing">
                    ~
                  </span>
                )}
                <span className="truncate">{effectiveProviderLabel}</span>
                {isDynamicProvider && (
                  <span
                    className="inline-flex"
                    title="Dynamic provider: always picks the cheapest based on pricing"
                  >
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </span>
                )}
              </span>
              <span className="mx-2 flex-shrink-0">
                {formatTokensPerSat(
                  effectiveModelForPricing?.sats_pricing?.completion
                )}
              </span>
              {!isAvailable && requiredMin > 0 && (
                <span className="text-yellow-600 dark:text-yellow-400 font-medium flex-shrink-0">
                  • Min: {requiredMin.toFixed(0)} sats
                </span>
              )}
            </div>
          </div>

          {/* Selected Indicator */}
          {isSelectedItem && (
            <div
              className={`text-xs font-medium flex-shrink-0 text-green-600 dark:text-green-400`}
            >
              ✓
            </div>
          )}

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
              className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
              title="View details"
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
    // Determine provider base for details: prefer explicit detailsBaseUrl, otherwise mapping
    const baseForDetails =
      normalizeBaseUrl(detailsBaseUrl) ||
      normalizeBaseUrl(modelProviderMap[model.id]);
    const providerModels = baseForDetails
      ? providerModelCache[baseForDetails]
      : undefined;
    const providerSpecificModel = providerModels
      ? providerModels[model.id]
      : undefined;
    const effectiveModel = providerSpecificModel || model;
    // Date formatter for created timestamp (epoch seconds)
    const formatDate = (epochSeconds?: number): string => {
      try {
        if (
          typeof epochSeconds !== "number" ||
          !isFinite(epochSeconds) ||
          epochSeconds <= 0
        )
          return "—";
        const d = new Date(epochSeconds * 1000);
        if (isNaN(d.getTime())) return "—";
        return d.toLocaleDateString();
      } catch {
        return "—";
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
            <div className="text-xs text-muted-foreground">
              {getProviderFromModelName(effectiveModel.name)}
            </div>
            <div className="text-base font-semibold truncate text-foreground">
              {getModelNameWithoutProvider(effectiveModel.name)}
            </div>
            <div className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-2">
              <span className="break-all" title="Model ID">
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
                title="Copy model ID"
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
                  · {formatDate(effectiveModel.created)}
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
          <div className="bg-muted/50 rounded-md p-2 border border-border">
            <div className="text-muted-foreground">Context length</div>
            <div className="font-medium mt-1 text-foreground">
              {effectiveModel.context_length?.toLocaleString?.() ?? "—"} tokens
            </div>
          </div>
          <div className="bg-muted/50 rounded-md p-2 border border-border">
            <div className="text-muted-foreground">Modality</div>
            <div className="font-medium mt-1 text-foreground">
              <div className="flex flex-wrap gap-2">
                {ioPairs.length > 0 ? (
                  ioPairs.map((p) => (
                    <span
                      key={p.key}
                      className="inline-flex items-center gap-1"
                      title={`${p.input} → ${p.output}`}
                    >
                      {modalityIconFor(p.input)}
                      <span>→</span>
                      {modalityIconFor(p.output)}
                    </span>
                  ))
                ) : (
                  <span>—</span>
                )}
              </div>
            </div>
          </div>
          <div className="bg-muted/50 rounded-md p-2 border border-border">
            <div className="text-muted-foreground">Tokenizer</div>
            <div className="font-medium mt-1 text-foreground">
              {effectiveModel.architecture?.tokenizer ?? "—"}
            </div>
          </div>
          <div className="bg-muted/50 rounded-md p-2 border border-border">
            <div className="text-muted-foreground">Instruct type</div>
            <div className="font-medium mt-1 text-foreground">
              {effectiveModel.architecture?.instruct_type ?? "—"}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Pricing</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-muted/50 rounded-md p-2 border border-border">
              <div className="text-muted-foreground">Prompt</div>
              <div className="font-medium mt-1 text-foreground">
                {formatTokensPerSat(effectiveModel?.sats_pricing?.prompt)}
              </div>
            </div>
            <div className="bg-muted/50 rounded-md p-2 border border-border">
              <div className="text-muted-foreground">Completion</div>
              <div className="font-medium mt-1 text-foreground">
                {formatTokensPerSat(effectiveModel?.sats_pricing?.completion)}
              </div>
            </div>
          </div>
          {effectiveModel?.sats_pricing && (
            <div className="text-[11px] text-muted-foreground/80">
              Est. min: {getRequiredSatsForModel(effectiveModel).toFixed(0)}{" "}
              sats
            </div>
          )}
        </div>

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
        className={`flex items-center gap-2 text-foreground bg-muted/50 hover:bg-muted rounded-md py-2 px-3 sm:px-4 h-[36px] text-xs sm:text-sm transition-colors cursor-pointer border overflow-hidden max-w-[calc(100vw-260px)] sm:max-w-none ${
          lowBalanceWarningForModel ? "border-red-500" : "border-border"
        }`}
        data-tutorial="model-selector"
        type="button"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium truncate whitespace-nowrap">
            {selectedModel
              ? getModelNameWithoutProvider(selectedModel.name)
              : "Select Model"}
          </span>
          {lowBalanceWarningForModel && !isWalletLoading && (
            <span className="text-red-600 dark:text-red-400 text-[10px] font-medium whitespace-nowrap">
              low balance
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${
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
              ? "fixed left-1/2 -translate-x-1/2 top-[60px] w-[92vw]"
              : "absolute top-full left-0 w-[720px] max-w-[95vw] mt-1"
          } bg-card border border-border rounded-md shadow-lg max-h-[70vh] overflow-hidden z-50 transform transition-all duration-200 ${
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
            } overflow-y-auto max-h-[70vh]`}
          >
            {activeView === "list" ? (
              <div>
                {/* Search bar */}
                <div className="sticky top-0 p-2 bg-card backdrop-blur-sm border-b border-border">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search models..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="w-full bg-muted/50 border border-border rounded-md py-1 pl-8 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-2">
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="flex items-center text-muted-foreground hover:text-foreground"
                          title="Clear"
                          type="button"
                        >
                          <span className="text-xs">×</span>
                        </button>
                      )}
                      {openModelsConfig && (
                        <button
                          onClick={() => openModelsConfig()}
                          className="text-muted-foreground hover:text-foreground"
                          title="Configure models"
                          type="button"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {renderQuickFilters()}
                </div>

                {isLoadingModels ? (
                  <div className="flex justify-center items-center py-4">
                    <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                  </div>
                ) : (
                  <div className="overflow-y-auto max-h-[60vh] pb-3">
                    {/* Current Model Section */}
                    {selectedModel && (
                      <div className="p-1">
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
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

                    {/* Favorite Models Section */}
                    {favoriteEntries.length > 0 && (
                      <div className="p-1">
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                          Favorites
                        </div>
                        <div className="space-y-1">
                          {favoriteEntries.map((entry) =>
                            renderModelItem(
                              entry.model,
                              true,
                              entry.providerLabel,
                              entry.key
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {/* Separator */}
                    {(!!selectedModel || favoriteEntries.length > 0) &&
                      remainingModelsList.length > 0 && (
                        <div className="border-t border-border my-1" />
                      )}

                    {/* Recommended Models Section */}
                    <div className="p-1">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        Recommended Models
                      </div>
                      {recommendedModelsList.length > 0 ? (
                        <div className="space-y-1">
                          {recommendedModelsList.map((model) =>
                            renderModelItem(model, false)
                          )}
                        </div>
                      ) : (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          No models found
                        </div>
                      )}
                    </div>

                    {/* Separator */}
                    {(!!selectedModel || favoriteEntries.length > 0) &&
                      remainingModelsList.length > 0 && (
                        <div className="border-t border-border my-1" />
                      )}

                    {/* All Models Section */}
                    <div className="p-1">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        All Models{" "}
                        {uniqueModelCount > 0 && uniqueProviderCount > 0 && (
                          <span className="text-muted-foreground/70">
                            ({uniqueModelCount} models from{" "}
                            {uniqueProviderCount} providers)
                          </span>
                        )}
                      </div>
                      {remainingModelsList.length > 0 ? (
                        <div className="space-y-1">
                          {remainingModelsList
                            .filter((m) => m.id !== selectedModel?.id)
                            .map((model) => renderModelItem(model, false))}
                        </div>
                      ) : (
                        <div className="p-2 text-sm text-muted-foreground text-center">
                          No models found
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
          <div className="hidden sm:grid grid-cols-2">
            {/* Left: Search + List */}
            <div className="border-r border-border">
              {/* Search bar */}
              <div className="sticky top-0 p-2 bg-card backdrop-blur-sm border-b border-border">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search models..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    className="w-full bg-muted/50 border border-border rounded-md py-1 pl-8 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-2">
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="flex items-center text-muted-foreground hover:text-foreground"
                        title="Clear"
                        type="button"
                      >
                        <span className="text-xs">×</span>
                      </button>
                    )}
                    {openModelsConfig && (
                      <button
                        onClick={() => openModelsConfig()}
                        className="text-muted-foreground hover:text-foreground"
                        title="Configure models"
                        type="button"
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {renderQuickFilters()}
              </div>

              {isLoadingModels ? (
                <div className="flex justify-center items-center py-4">
                  <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[60vh] pb-3">
                  {/* Current Model Section */}
                  {selectedModel && (
                    <div className="p-1">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
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

                  {/* Favorite Models Section */}
                  {favoriteEntries.length > 0 && (
                    <div className="p-1">
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        Favorites
                      </div>
                      <div className="space-y-1">
                        {favoriteEntries.map((entry) =>
                          renderModelItem(
                            entry.model,
                            true,
                            entry.providerLabel,
                            entry.key
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Separator */}
                  {(!!selectedModel || favoriteEntries.length > 0) &&
                    remainingModelsList.length > 0 && (
                      <div className="border-t border-border my-1" />
                    )}

                  {/* Recommended Models Section */}
                  <div className="p-1">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      Recommended Models
                    </div>
                    {recommendedModelsList.length > 0 ? (
                      <div className="space-y-1">
                        {recommendedModelsList.map((model) =>
                          renderModelItem(model, false)
                        )}
                      </div>
                    ) : (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        No models found
                      </div>
                    )}
                  </div>

                  {/* Separator */}
                  {(!!selectedModel || favoriteEntries.length > 0) &&
                    remainingModelsList.length > 0 && (
                      <div className="border-t border-border my-1" />
                    )}

                  {/* All Models Section */}
                  <div className="p-1">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      All Models{" "}
                      {uniqueModelCount > 0 && uniqueProviderCount > 0 && (
                        <span className="text-muted-foreground/70">
                          ({uniqueModelCount} models from {uniqueProviderCount}{" "}
                          providers)
                        </span>
                      )}
                    </div>
                    {remainingModelsList.length > 0 ? (
                      <div className="space-y-1">
                        {remainingModelsList
                          .filter((m) => m.id !== selectedModel?.id)
                          .map((model) => renderModelItem(model, false))}
                      </div>
                    ) : (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        No models found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Details */}
            <div className="p-3 overflow-y-auto max-h-[70vh]">
              {previewModel ? (
                renderModelDetails(previewModel)
              ) : (
                <div className="text-sm text-muted-foreground">
                  No model selected
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
