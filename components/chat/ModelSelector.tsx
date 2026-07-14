import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Search,
  Star,
  Info,
  Check,
} from "lucide-react";
import { Model } from "@/types/models";
import { getModelNameWithoutProvider } from "@/utils/modelUtils";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { loadModelProviderMap } from "@/utils/storageUtils";
import { useDisabledProviders } from "@/hooks/useDisabledProviders";
import {
  useModelPricing,
  formatProviderLabel,
} from "./model-selector/useModelPricing";
import {
  useModelFilters,
  rowKeyOf,
  rowPinnedBase,
  findRowPricingEntry,
  dynamicBaseFor,
  MODEL_RENDER_INCREMENT,
  type ModelRowEntry,
} from "./model-selector/useModelFilters";
import { normalizeModality } from "./model-selector/modality";
import { PriceMeter } from "./model-selector/display";
import ModelDetailsPane from "./model-selector/ModelDetailsPane";
import FilterToolbar, { CompanyRail } from "./model-selector/FilterToolbar";
import {
  parseModelKey,
  normalizeBaseUrl,
  getRequiredSatsForModel,
  isModelAvailable,
} from "@/utils/modelUtils";
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
  lowBalanceWarningForModel: boolean;
}


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
  lowBalanceWarningForModel,
}: ModelSelectorProps) {
  // Providers list models this app cannot drive: embeddings return vectors and
  // fail in /chat/completions, and the composer only ever sends text.
  const dedupedModels = useMemo(
    () =>
      dedupedModelsRaw.filter((model) => {
        // Raw compare, NOT normalizeModality: that maps unknowns to "text",
        // which would let "embeddings" back in.
        const outputs = model.architecture?.output_modalities;
        const canAnswer =
          !outputs?.length ||
          outputs
            .map((o) => String(o ?? "").toLowerCase())
            .some((o) => o === "text" || o === "image");
        if (!canAnswer) return false;

        const inputs = model.architecture?.input_modalities;
        return (
          !inputs?.length || inputs.map(normalizeModality).some((i) => i === "text")
        );
      }),
    [dedupedModelsRaw]
  );

  const modelDrawerRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Disabled providers come from the SDK store (single source of truth used
  // for routing), not a separate localStorage list.
  const { disabledProviders } = useDisabledProviders();
  // By ROW, not model: sibling favorite rows must highlight independently.
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [activeView, setActiveView] = useState<"list" | "details">("list");
  const [isTransitioning, setIsTransitioning] = useState(false);
  // A ROW, not a model plus a loose base url: those two could drift, and the
  // pane would describe a provider the row never used.
  const [detailsRow, setDetailsRow] = useState<ModelRowEntry | null>(null);
  const [modelProviderMap, setModelProviderMap] = useState<
    Record<string, string>
  >({});
  const [copiedModelId, setCopiedModelId] = useState<string | null>(null);
  // Drawer open/close animation state
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isDrawerAnimating, setIsDrawerAnimating] = useState(false);
  const effectiveBalance = balance + getPendingCashuTokenAmount();

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

  // Resolved against the ACTIVE provider, not "first key wins": a model
  // favorited on both A and B reported A as current while the chat was on B.
  const currentConfiguredKeyMemo: string | undefined = useMemo(() => {
    if (!selectedModel) return undefined;
    const keys = configuredModels.filter(
      (key) => parseModelKey(key).id === selectedModel.id
    );
    if (keys.length === 0) return undefined;
    const activeBase = normalizeBaseUrl(modelProviderMap[selectedModel.id]);
    const exact = activeBase
      ? keys.find(
          (key) => normalizeBaseUrl(parseModelKey(key).base) === activeBase
        )
      : undefined;
    // No keys[0] last resort: if the chat is on a provider the model is not
    // favorited on, no favorite row is current. Claiming one would hide it.
    return exact ?? keys.find((key) => key === selectedModel.id);
  }, [configuredModels, selectedModel, modelProviderMap]);

  const currentSelectedBaseUrl: string | null = useMemo(() => {
    // The base encoded in the configured key, else the cheapest mapping.
    if (currentConfiguredKeyMemo && currentConfiguredKeyMemo.includes("@@")) {
      const parsed = parseModelKey(currentConfiguredKeyMemo);
      return normalizeBaseUrl(parsed.base);
    }
    if (selectedModel) {
      return normalizeBaseUrl(modelProviderMap[selectedModel.id]);
    }
    return null;
  }, [currentConfiguredKeyMemo, selectedModel, modelProviderMap]);

  const {
    getProviderPricingEntries,
    getCachedModelFor,
    providerOptions,
    getPricingIndex,
  } = useModelPricing({
    models: dedupedModels,
    disabledProviders,
    modelProviderMap,
    configuredModels,
    selectedModel,
  });

  // Kept as one object so the whole filter surface reaches FilterToolbar as a
  // single prop instead of twenty forwarded ones.
  const filters = useModelFilters({
    models: dedupedModels,
    selectedModel,
    currentConfiguredKey: currentConfiguredKeyMemo,
    configuredModels,
    effectiveBalance,
    providerOptions,
    getProviderPricingEntries,
  });

  const {
    setSearchQuery,
    deferredSearchQuery,
    selectedCompany,
    setSelectedCompany,
    selectedProvider,
    setSelectedProvider,
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
  } = filters;

  const selectCompany = (companyId: string) => {
    setSelectedCompany(companyId);
    setHoveredRowKey(null);
  };

  // Which ROW the right pane describes. Keyed off the hovered row so a favorite
  // pinned to provider A previews A, not the model's default provider.
  const previewRow: ModelRowEntry | null = useMemo(() => {
    const fromHover = allModelEntries.find(
      (entry) => rowKeyOf(entry) === hoveredRowKey
    );
    if (fromHover) return fromHover;
    if (selectedModel) {
      return {
        model: selectedModel as Model,
        configuredKey: currentConfiguredKeyMemo,
      };
    }
    return allModelEntries[0] ?? null;
  }, [
    allModelEntries,
    hoveredRowKey,
    selectedModel,
    currentConfiguredKeyMemo,
  ]);

  // A row is a (model, provider) pair. The ONLY provider resolver: rows, the
  // details pane and keyboard selection all use it, so they cannot disagree.
  const resolveRow = (row: ModelRowEntry) => {
    const { model } = row;
    const pinnedBase = rowPinnedBase(row);
    const pricingEntries = getProviderPricingEntries(model.id);
    // The Current row describes the provider the chat is ACTUALLY on; the
    // provider filter only re-interprets the selectable list, so it must not
    // relabel a selection that was already routed.
    const isCurrentRow =
      selectedModel?.id === model.id &&
      row.configuredKey === currentConfiguredKeyMemo;
    const dynamicBase =
      isCurrentRow && !pinnedBase && currentSelectedBaseUrl
        ? currentSelectedBaseUrl
        : dynamicBaseFor(selectedProvider);
    const entry = findRowPricingEntry(row, pricingEntries, dynamicBase);

    // A pinned row is unroutable when the ranking drops its provider (disabled
    // or cooling down). Price it from that provider's OWN cache entry and
    // disable it, never borrow another provider's number. A dynamic row claims
    // no provider, so it falls back to the model and stays selectable.
    const priceSource = pinnedBase
      ? entry?.model ?? getCachedModelFor(pinnedBase, model.id) ?? null
      : entry?.model ?? model;
    const isRoutable = pinnedBase ? !!entry : true;

    return {
      fixedBase: pinnedBase,
      baseForPricing: pinnedBase ?? entry?.baseUrl ?? null,
      pricingEntries,
      priceSource,
      isRoutable,
      isAvailable:
        isRoutable && !!priceSource && isModelAvailable(priceSource, effectiveBalance),
    };
  };

  const selectRow = (row: ModelRowEntry) => {
    const { fixedBase, baseForPricing, isAvailable } = resolveRow(row);
    if (!isAvailable) return;
    if (fixedBase && setModelProviderFor) {
      setModelProviderFor(row.model.id, fixedBase);
    }
    // If the row CLAIMS a provider (pinned, or filtered to one) select that
    // exact provider, so the request bills the one the user saw. Keying off
    // configuredKey instead would miss a plain-key favorite under a filter: it
    // has a key but no provider, and would silently route to the cheapest.
    // An unfiltered row claims nothing and stays dynamic, keeping SDK failover.
    const claimsProvider = !!fixedBase || selectedProvider !== "all";
    const selectedKey =
      claimsProvider && baseForPricing
        ? `${row.model.id}@@${baseForPricing}`
        : row.configuredKey;
    handleModelChange(row.model.id, selectedKey);
    setIsModelDrawerOpen(false);
  };

  const selectProviderForModel = (model: Model, baseUrl: string) => {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return;
    setModelProviderMap((prev) => ({ ...prev, [model.id]: normalized }));
    setModelProviderFor?.(model.id, normalized);
    // Repoint the pane at the provider just picked.
    setDetailsRow({ model, configuredKey: `${model.id}@@${normalized}` });
    handleModelChange(model.id, `${model.id}@@${normalized}`);
  };

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

  // Keyboard navigation over the visible list (from the search input)
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // allModelEntries folds in every filter/sort input, so this covers them all
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [allModelEntries]);

  // Switching company/provider/sort/search swaps the list; scroll back to the
  // top so it does not keep the previous view's offset. Keyed on the explicit
  // filter inputs, not on the list itself, so a background cache refresh does
  // not yank the user's scroll mid-browse.
  useEffect(() => {
    modelDrawerRef.current
      ?.querySelectorAll(".model-selector-list")
      .forEach((el) => {
        (el as HTMLElement).scrollTop = 0;
      });
  }, [
    selectedCompany,
    selectedProvider,
    filters.sortMode,
    filters.sortDirection,
    deferredSearchQuery,
  ]);

  useEffect(() => {
    const pane = modelDrawerRef.current?.querySelector(".model-details-scroll");
    if (pane) (pane as HTMLElement).scrollTop = 0;
  }, [previewRow?.model.id, previewRow?.configuredKey]);

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
      setDetailsRow(null);
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
      // Radix portals popover content to body, so it is outside modelDrawerRef
      const targetElement =
        target instanceof Element ? target : target.parentElement;
      const clickedInsidePopover = !!targetElement?.closest(
        '[data-slot="popover-content"]'
      );
      if (!clickedInsideDrawer && !clickedToggle && !clickedInsidePopover) {
        setIsModelDrawerOpen(false);
      }
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
      const entry = visibleAllModelEntries[highlightedIndex];
      // Same path as a click: resolveRow decides affordability from the row's
      // own provider, and a pinned favorite gets its provider persisted.
      if (entry) selectRow(entry);
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
    // The list is rendered twice (mobile + desktop); the hidden copy has no
    // offsetParent, so scroll the one that is actually visible.
    const rows = modelDrawerRef.current?.querySelectorAll(
      `[data-model-row="${highlightedIndex}"]`
    );
    rows &&
      Array.from(rows)
        .find((el) => (el as HTMLElement).offsetParent !== null)
        ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

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
            {renderModelItem({
              model: selectedModel,
              configuredKey: currentConfiguredKeyMemo,
            })}
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
            {visibleAllModelEntries.map((entry, index) =>
              renderModelItem(entry, index)
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
  const renderModelItem = (row: ModelRowEntry, rowIndex?: number) => {
    const { model, configuredKey: configuredKeyOverride } = row;
    // The deduped `model` carries whichever provider's pricing survived dedupe,
    // so pricing off it greys out models the user can actually afford.
    const {
      fixedBase,
      baseForPricing,
      pricingEntries,
      priceSource,
      isRoutable,
      isAvailable,
    } = resolveRow(row);
    const rowKey = rowKeyOf(row);
    const isFixedProvider = fixedBase !== null;
    const providerCount = isFixedProvider ? 0 : pricingEntries.length;
    const requiredMin = priceSource ? getRequiredSatsForModel(priceSource) : 0;
    const favoriteKeysForModel = configuredModels.filter(
      (key) => parseModelKey(key).id === model.id
    );
    // A row that claims a provider (a favorite key, or any row under a provider
    // filter) stars the exact `${id}@@${base}`, so stars on different providers
    // stay independent. An unfiltered row keeps the by-id "favorited somewhere".
    const claimsProvider = !!configuredKeyOverride || selectedProvider !== "all";
    const claimedKey =
      configuredKeyOverride ??
      (selectedProvider !== "all" && baseForPricing
        ? `${model.id}@@${baseForPricing}`
        : model.id);
    const isFav = claimsProvider
      ? configuredModels.includes(claimedKey)
      : isConfiguredModel(model.id);
    const effectiveProviderLabel = formatProviderLabel(
      baseForPricing,
      priceSource ?? model
    );
    // A filtered row shows one provider's price, so it is not "auto-cheapest".
    const isDynamicProvider = !isFixedProvider && selectedProvider === "all";
    // Selection is provider-specific only when the row pins a provider.
    const idMatches = selectedModel?.id === model.id;
    const providerMatches = isFixedProvider
      ? Boolean(currentSelectedBaseUrl && currentSelectedBaseUrl === baseForPricing)
      : true;
    const isSelectedItem = Boolean(idMatches && providerMatches);
    return (
      <div
        key={rowKey}
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
              : rowKey === hoveredRowKey
                ? // Persistent cue for the row the details pane is describing;
                  // plain :hover vanishes once the cursor moves to the pane.
                  "bg-muted/60 border-border shadow-e1 cursor-pointer"
                : "bg-card/25 hover:bg-muted/35 hover:border-border/70 hover:shadow-e1 border-border/35 cursor-pointer"
        } ${
          rowIndex !== undefined && rowIndex === highlightedIndex
            ? "ring-2 ring-ring/40"
            : ""
        }`}
        onMouseEnter={() => setHoveredRowKey(rowKey)}
      >
        <div className="flex min-w-0 items-center gap-3">
          {/* Favorite toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isFav) {
                // A provider-claiming row un-stars only its own key; an
                // unfiltered all-models row drops every key the model has.
                const keysToRemove = claimsProvider
                  ? [claimedKey]
                  : favoriteKeysForModel.length > 0
                    ? favoriteKeysForModel
                    : [model.id];
                keysToRemove.forEach((key) => toggleConfiguredModel(key));
                return;
              }

              toggleConfiguredModel(claimedKey);
            }}
            className={`shrink-0 rounded-lg border border-transparent p-1 transition-colors cursor-pointer group-hover/model:border-border/40 group-hover/model:bg-muted/30 ${
              isFav
                ? "text-yellow-500 hover:text-yellow-400"
                : "text-muted-foreground hover:text-yellow-500"
            }`}
            data-tooltip={isFav ? "Remove from favorites" : "Add to favorites"}
            data-tooltip-side="right"
            type="button"
            aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={isFav}
          >
            <Star className={`h-3.5 w-3.5 ${isFav ? "fill-current" : ""}`} />
          </button>
          {/* Model Info - Clickable area for selection */}
          <div
            className={`flex-1 min-w-0 ${
              isAvailable ? "cursor-pointer" : "cursor-not-allowed"
            }`}
            aria-disabled={!isAvailable}
            onClick={() => selectRow(row)}
          >
            <div className="flex items-center gap-1.5 truncate font-semibold text-foreground">
              <span className="truncate">
                {getModelNameWithoutProvider(model.name)}
              </span>
              {isSelectedItem && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
              {!isRoutable ? (
                <span
                  className="text-[10px] text-muted-foreground/70 font-medium shrink-0"
                  data-tooltip="This provider is disabled or temporarily unreachable"
                  data-tooltip-side="right"
                >
                  Provider unavailable
                </span>
              ) : (
                !isAvailable &&
                requiredMin > 0 && (
                  <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium shrink-0">
                    {requiredMin < 1
                      ? "Min: <1 sat"
                      : `Min: ${Math.round(requiredMin)} sats`}
                  </span>
                )
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
              <PriceMeter
                value={getPricingIndex(priceSource?.sats_pricing?.completion)}
                satsPerToken={priceSource?.sats_pricing?.completion}
              />
            </div>
          </div>

          {/* Mobile: Details view navigation trigger */}
          {isMobile && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDetailsRow(row);
                navigateToView("details");
              }}
              className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
              data-tooltip="View details"
              data-tooltip-side="left"
              type="button"
              aria-label="View model details"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderModelDetails = (row: ModelRowEntry) => {
    const { priceSource, baseForPricing } = resolveRow(row);
    return (
      <ModelDetailsPane
        model={row.model}
        effectiveModel={priceSource ?? row.model}
        baseForDetails={baseForPricing}
        selectedModel={selectedModel}
        currentSelectedBaseUrl={currentSelectedBaseUrl}
        modelProviderMap={modelProviderMap}
        copiedModelId={copiedModelId}
        setCopiedModelId={setCopiedModelId}
        getProviderPricingEntries={getProviderPricingEntries}
        selectProviderForModel={selectProviderForModel}
      />
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
          onMouseLeave={() => setHoveredRowKey(null)}
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
                {<FilterToolbar
                  filters={filters}
                  providerOptions={providerOptions}
                  uniqueModelCount={uniqueModelCount}
                  uniqueProviderCount={uniqueProviderCount}
                  openModelsConfig={openModelsConfig}
                  searchInputRef={searchInputRef}
                  onSearchKeyDown={handleSearchKeyDown}
                  onSelectCompany={selectCompany}
                />}
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
                {detailsRow ? (
                  <div className="space-y-3">
                    {renderModelDetails(detailsRow)}
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
                {
                  <CompanyRail
                    companyFilters={companyFilters}
                    selectedCompany={selectedCompany}
                    onSelectCompany={selectCompany}
                    orientation="vertical"
                  />
                }
              </div>
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                {<FilterToolbar
                  filters={filters}
                  providerOptions={providerOptions}
                  uniqueModelCount={uniqueModelCount}
                  uniqueProviderCount={uniqueProviderCount}
                  openModelsConfig={openModelsConfig}
                  searchInputRef={searchInputRef}
                  onSearchKeyDown={handleSearchKeyDown}
                  onSelectCompany={selectCompany}
                />}
                {isLoadingModels && dedupedModels.length === 0
                  ? renderLoadingState()
                  : renderModelListSections()}
              </div>
            </div>

            {/* Right: Details */}
            <div className="model-details-scroll slim-scroll h-full min-h-0 overflow-y-auto overflow-x-hidden bg-background/20 p-4 [scrollbar-gutter:stable]">
              {previewRow ? (
                renderModelDetails(previewRow)
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
