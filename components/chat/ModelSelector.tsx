import { useRef, useEffect, useState, useMemo } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Search, Settings, Star } from 'lucide-react';
import { Model } from '@/data/models';
import { getModelNameWithoutProvider, getProviderFromModelName } from '@/data/models';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { loadModelProviderMap } from '@/utils/storageUtils';

interface ModelSelectorProps {
  selectedModel: Model | null;
  isModelDrawerOpen: boolean;
  setIsModelDrawerOpen: (isOpen: boolean) => void;
  isAuthenticated: boolean;
  setIsLoginModalOpen: (isOpen: boolean) => void;
  isLoadingModels: boolean;
  filteredModels: Model[];
  handleModelChange: (modelId: string) => void;
  balance: number;
  configuredModels: string[];
  openModelsConfig?: () => void;
  toggleConfiguredModel: (modelId: string) => void;
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
}: ModelSelectorProps) {
  const modelDrawerRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [activeView, setActiveView] = useState<'list' | 'details'>('list');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [detailsModel, setDetailsModel] = useState<Model | null>(null);
  const [modelProviderMap, setModelProviderMap] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      setModelProviderMap(loadModelProviderMap());
    } catch {
      setModelProviderMap({});
    }
  }, []);

  // Deduplicate models across providers by picking the best-priced variant per id
  const dedupedModels = useMemo(() => {
    const bestById = new Map<string, Model>();
    for (const m of models) {
      const existing = bestById.get(m.id);
      if (!existing) {
        bestById.set(m.id, m);
        continue;
      }
      const currentCost = getEstimatedMinCost(m);
      const existingCost = getEstimatedMinCost(existing);
      if (currentCost < existingCost) {
        bestById.set(m.id, m);
      }
    }
    return Array.from(bestById.values());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  // Filter models based on search query
  const filteredModels = dedupedModels.filter(model => 
    getModelNameWithoutProvider(model.name).toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Determine which model's details to show in the right pane
  const previewModel: Model | null = useMemo(() => {
    const fromHover = filteredModels.find(m => m.id === hoveredModelId);
    if (fromHover) return fromHover;
    if (selectedModel && filteredModels.some(m => m.id === selectedModel.id)) return selectedModel as Model;
    return filteredModels[0] ?? null;
  }, [filteredModels, hoveredModelId, selectedModel]);

  // Display helpers: convert sats/token -> tokens/sat
  const computeTokensPerSat = (satsPerToken?: number): number | null => {
    if (typeof satsPerToken !== 'number' || !isFinite(satsPerToken) || satsPerToken <= 0) return null;
    return 1 / satsPerToken;
  };

  const formatTokensPerSat = (satsPerToken?: number): string => {
    const value = computeTokensPerSat(satsPerToken);
    if (value === null) return '—';
    if (value >= 1000) return `${Math.round(value).toLocaleString()} token/sat`;
    return `${value.toFixed(2)} token/sat`;
  };

  // Helpers to parse provider-qualified keys
  const parseModelKey = (key: string): { id: string; base: string | null } => {
    const sep = key.indexOf('@@');
    if (sep === -1) return { id: key, base: null };
    return { id: key.slice(0, sep), base: key.slice(sep + 2) };
  };

  const formatProviderLabel = (baseUrl: string | null | undefined, model: Model): string => {
    try {
      if (baseUrl) {
        const url = new URL(baseUrl);
        return url.host;
      }
    } catch {}
    return getProviderFromModelName(model.name);
  };

  // Treat a model as configured if any configured key matches its id or `${id}@@...`
  const isConfiguredModel = (modelId: string) => {
    return configuredModels.some(key => key === modelId || key.startsWith(`${modelId}@@`));
  };

  // Split into configured and all (remaining) models
  const configuredModelsList = filteredModels.filter(model => isConfiguredModel(model.id));
  const remainingModelsList = filteredModels.filter(model => !isConfiguredModel(model.id));

  // Build favorites entries with provider labels from configured keys
  const favoriteEntries = useMemo(() => {
    return configuredModels
      .map((key) => {
        const { id, base } = parseModelKey(key);
        const model = filteredModels.find(m => m.id === id);
        if (!model) return null;
        const mappedBase = base || modelProviderMap[key] || modelProviderMap[id];
        const providerLabel = formatProviderLabel(mappedBase, model);
        return { key, model, providerLabel } as { key: string; model: Model; providerLabel: string };
      })
      .filter((e): e is { key: string; model: Model; providerLabel: string } => !!e);
  }, [configuredModels, filteredModels, modelProviderMap]);

  // Check if a model is available based on balance
  const isModelAvailable = (model: Model) => {
    try {
      if (!model?.sats_pricing) return true; // If no pricing, assume available
      const estimatedMinCost = getEstimatedMinCost(model);
      if (!estimatedMinCost || estimatedMinCost <= 0) return true;
      return balance >= estimatedMinCost;
    }
    catch(error){ 
      console.log(model);
      console.error(error);
    }
  };

  // Calculate the minimum estimated sats needed to run this model
  const getEstimatedMinCost = (model: Model): number => {
    try {
      if (!model?.sats_pricing) return 0;
      const { prompt, max_cost, max_completion_cost } = model.sats_pricing as any;

      // Fallback to max_cost when max_completion_cost isn't provided
      if (typeof max_completion_cost !== 'number') {
        return typeof max_cost === 'number' ? max_cost : 0;
      }

      const approximateTokens = 2000;
      const promptCosts = typeof prompt === 'number' ? prompt * approximateTokens : 0;
      const totalEstimatedCosts = promptCosts + max_completion_cost;
      return typeof totalEstimatedCosts === 'number' && isFinite(totalEstimatedCosts)
        ? totalEstimatedCosts
        : 0;
    } catch (error) {
      console.error(error);
      return 0;
    }
  };

  // Focus search input when drawer opens
  useEffect(() => {
    if (isModelDrawerOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    } else {
      setSearchQuery('');
    }
  }, [isModelDrawerOpen]);

  // Reset mobile view state when opening/closing
  useEffect(() => {
    if (isModelDrawerOpen) {
      setActiveView('list');
      setDetailsModel(null);
      setIsTransitioning(false);
    }
  }, [isModelDrawerOpen]);

  // Page-like transition for mobile
  const navigateToView = (view: 'list' | 'details') => {
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveView(view);
      setIsTransitioning(false);
    }, 150);
  };

  // Close model drawer when clicking outside (ignore clicks on the toggle button)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isModelDrawerOpen) return;
      const target = event.target as Node;
      const clickedInsideDrawer = modelDrawerRef.current?.contains(target);
      const clickedToggle = toggleButtonRef.current?.contains(target);
      if (!clickedInsideDrawer && !clickedToggle) setIsModelDrawerOpen(false);
    };

    if (isModelDrawerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDrawerOpen, setIsModelDrawerOpen]);

  // Handle search input keydown events
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent propagation to avoid closing the drawer
    e.stopPropagation();
    
    // Handle escape key to clear search
    if (e.key === 'Escape') {
      setSearchQuery('');
      e.preventDefault();
    }
  };

  // Render a model item
  const renderModelItem = (model: Model, isFavorite: boolean = false, providerLabel?: string, configuredKeyOverride?: string) => {
    const isAvailable = isModelAvailable(model);
    const estimatedMinCost = getEstimatedMinCost(model);
    const isFav = isFavorite || isConfiguredModel(model.id);
    return (
      <div
        key={`${configuredKeyOverride || model.id}`}
        className={`p-2 text-sm rounded-md transition-colors ${
          !isAvailable 
            ? 'opacity-40 cursor-not-allowed' 
            : selectedModel?.id === model.id
            ? 'bg-white/10 cursor-pointer'
            : 'hover:bg-white/5 cursor-pointer'
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
            className={`flex-shrink-0 p-0.5 rounded transition-colors cursor-pointer ${isFav ? 'text-yellow-400 hover:text-yellow-300' : 'text-white/30 hover:text-yellow-400'}`}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            type="button"
          >
            <Star className={`h-3 w-3 ${isFav ? 'fill-current' : ''}`} />
          </button>
          {/* Model Info - Clickable area for selection */}
          <div 
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => {
              if (isAvailable) {
                handleModelChange(model.id);
                setIsModelDrawerOpen(false);
              }
            }}
          >
            <div className={`font-medium truncate`}>
              {getModelNameWithoutProvider(model.name)}
            </div>
            {providerLabel ? (
              <div className="text-xs text-white/50 flex items-center justify-between">
                <span className="text-white/60 truncate pr-2">{providerLabel}</span>
                <span className="mx-2 flex-shrink-0">{formatTokensPerSat(model?.sats_pricing?.completion)}</span>
                {!isAvailable && estimatedMinCost > 0 && (
                  <span className="text-yellow-400 font-medium flex-shrink-0">• Min: {estimatedMinCost.toFixed(0)} sats</span>
                )}
              </div>
            ) : (
              <div className="text-xs text-white/50 flex items-center gap-2">
                <span>{formatTokensPerSat(model?.sats_pricing?.completion)}</span>
                {!isAvailable && estimatedMinCost > 0 && (
                  <span className="text-yellow-400 font-medium">• Min: {estimatedMinCost.toFixed(0)} sats</span>
                )}
              </div>
            )}
          </div>
          
          {/* Selected Indicator */}
          {selectedModel?.id === model.id && (
            <div className={`text-xs font-medium flex-shrink-0 text-green-400`}>
              ✓
            </div>
          )}

          {/* Mobile: Details view navigation trigger */}
          {isMobile && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDetailsModel(model);
                navigateToView('details');
              }}
              className="flex-shrink-0 p-1 rounded-md text-white/60 hover:text-white/90 hover:bg-white/5 cursor-pointer"
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
  const renderModelDetails = (model: Model) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-white/50">{getProviderFromModelName(model.name)}</div>
          <div className="text-base font-semibold truncate">{getModelNameWithoutProvider(model.name)}</div>
        </div>
      </div>

      {model.description && (
        <div className="text-xs text-white/60 line-clamp-4">
          {model.description}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-white/5 rounded-md p-2 border border-white/10">
          <div className="text-white/60">Context length</div>
          <div className="font-medium">{model.context_length?.toLocaleString?.() ?? '—'} tokens</div>
        </div>
        <div className="bg-white/5 rounded-md p-2 border border-white/10">
          <div className="text-white/60">Modality</div>
          <div className="font-medium">{model.architecture?.modality ?? '—'}</div>
        </div>
        <div className="bg-white/5 rounded-md p-2 border border-white/10">
          <div className="text-white/60">Tokenizer</div>
          <div className="font-medium">{model.architecture?.tokenizer ?? '—'}</div>
        </div>
        <div className="bg-white/5 rounded-md p-2 border border-white/10">
          <div className="text-white/60">Instruct type</div>
          <div className="font-medium">{model.architecture?.instruct_type ?? '—'}</div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-white/60">Pricing</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-white/5 rounded-md p-2 border border-white/10">
            <div className="text-white/60">Prompt</div>
            <div className="font-medium">
              {formatTokensPerSat(model?.sats_pricing?.prompt)}
            </div>
          </div>
          <div className="bg-white/5 rounded-md p-2 border border-white/10">
            <div className="text-white/60">Completion</div>
            <div className="font-medium">
              {formatTokensPerSat(model?.sats_pricing?.completion)}
            </div>
          </div>
        </div>
        {(model?.sats_pricing?.max_cost || model?.sats_pricing?.max_completion_cost) && (
          <div className="text-[11px] text-white/50">
            Est. min: {getEstimatedMinCost(model).toFixed(0)} sats
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-xs text-white/60">Capabilities</div>
        <div className="flex flex-wrap gap-1.5">
          {(model?.architecture?.input_modalities?.includes('image') || (model?.pricing?.image ?? 0) > 0) && (
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-white/10 border border-white/15">Images</span>
          )}
          {(model?.pricing?.web_search ?? 0) > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-white/10 border border-white/15">Web search</span>
          )}
          {(model?.pricing?.internal_reasoning ?? 0) > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-white/10 border border-white/15">Thinking</span>
          )}
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-white/10 border border-white/15">{model.architecture?.output_modalities?.join(', ') || 'Text output'}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative">
      <button
        ref={toggleButtonRef}
        onMouseDown={(e) => {
          e.stopPropagation();
          if (isAuthenticated) {
            setIsModelDrawerOpen(!isModelDrawerOpen);
          } else {
            setIsLoginModalOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
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
        className="flex items-center gap-2 text-white bg-white/5 hover:bg-white/10 rounded-md py-2 px-3 sm:px-4 h-[36px] text-xs sm:text-sm transition-colors cursor-pointer border border-white/10 overflow-hidden max-w-[calc(100vw-260px)] sm:max-w-none"
        data-tutorial="model-selector"
        type="button"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium truncate whitespace-nowrap">{selectedModel ? getModelNameWithoutProvider(selectedModel.name) : 'Select Model'}</span>
        </div>
        <ChevronDown className="h-4 w-4 text-white/70 flex-shrink-0" />
      </button>

      {isModelDrawerOpen && isAuthenticated && (
        <div
          ref={modelDrawerRef}
          id="model-selector-drawer"
          className="absolute top-full left-1/2 transform -translate-x-1/2 w-[720px] max-w-[95vw] mt-1 bg-black border border-white/10 rounded-md shadow-lg max-h-[70vh] overflow-hidden z-50"
          onMouseLeave={() => setHoveredModelId(null)}
        >
          {/* Mobile view: page-like transition between list and details */}
          <div className={`sm:hidden transition-all duration-300 ${isTransitioning ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0'} overflow-y-auto max-h-[70vh]`}>
            {activeView === 'list' ? (
              <div>
                {/* Search bar */}
                <div className="sticky top-0 p-2 bg-black/90 backdrop-blur-sm border-b border-white/10">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                      <Search className="h-3.5 w-3.5 text-white/40" />
                    </div>
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search models..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="w-full bg-white/5 border border-white/10 rounded-md py-1 pl-8 pr-10 text-sm text-white/90 placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                    <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-2">
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="flex items-center text-white/40 hover:text-white/60"
                          title="Clear"
                          type="button"
                        >
                          <span className="text-xs">×</span>
                        </button>
                      )}
                      {openModelsConfig && (
                        <button
                          onClick={() => openModelsConfig()}
                          className="text-white/60 hover:text-white"
                          title="Configure models"
                          type="button"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {isLoadingModels ? (
                  <div className="flex justify-center items-center py-4">
                    <Loader2 className="h-5 w-5 text-white/50 animate-spin" />
                  </div>
                ) : (
                  <div className="overflow-y-auto max-h-[60vh]">
                    {/* Favorite Models Section */}
                    {favoriteEntries.length > 0 && (
                      <div className="p-1">
                        <div className="px-2 py-1 text-xs font-medium text-white/60">Favorites</div>
                        <div className="space-y-1">
                          {favoriteEntries.map((entry) => renderModelItem(entry.model, true, entry.providerLabel, entry.key))}
                        </div>
                      </div>
                    )}

                    {/* Separator */}
                    {favoriteEntries.length > 0 && remainingModelsList.length > 0 && (
                      <div className="border-t border-white/10 my-1" />
                    )}

                    {/* All Models Section */}
                    <div className="p-1">
                      <div className="px-2 py-1 text-xs font-medium text-white/60">All Models</div>
                      {remainingModelsList.length > 0 ? (
                        <div className="space-y-1">
                          {remainingModelsList.map((model) => renderModelItem(model, false))}
                        </div>
                      ) : (
                        <div className="p-2 text-sm text-white/50 text-center">No models found</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 space-y-3">
                <button
                  onClick={() => navigateToView('list')}
                  className="text-white/70 hover:text-white transition-colors cursor-pointer"
                  type="button"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                {detailsModel ? (
                  <div className="space-y-3">
                    {renderModelDetails(detailsModel)}
                  </div>
                ) : (
                  <div className="text-sm text-white/50">No model selected</div>
                )}
              </div>
            )}
          </div>

          {/* Desktop view: side-by-side list and details */}
          <div className="hidden sm:grid grid-cols-2">
            {/* Left: Search + List */}
            <div className="border-r border-white/10">
              {/* Search bar */}
              <div className="sticky top-0 p-2 bg-black/90 backdrop-blur-sm border-b border-white/10">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                    <Search className="h-3.5 w-3.5 text-white/40" />
                  </div>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search models..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    className="w-full bg-white/5 border border-white/10 rounded-md py-1 pl-8 pr-10 text-sm text-white/90 placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                  <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-2">
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="flex items-center text-white/40 hover:text-white/60"
                        title="Clear"
                        type="button"
                      >
                        <span className="text-xs">×</span>
                      </button>
                    )}
                    {openModelsConfig && (
                      <button
                        onClick={() => openModelsConfig()}
                        className="text-white/60 hover:text-white"
                        title="Configure models"
                        type="button"
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {isLoadingModels ? (
                <div className="flex justify-center items-center py-4">
                  <Loader2 className="h-5 w-5 text-white/50 animate-spin" />
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[60vh]">
                  {/* Favorite Models Section */}
                  {favoriteEntries.length > 0 && (
                    <div className="p-1">
                      <div className="px-2 py-1 text-xs font-medium text-white/60">Favorites</div>
                      <div className="space-y-1">
                        {favoriteEntries.map((entry) => renderModelItem(entry.model, true, entry.providerLabel, entry.key))}
                      </div>
                    </div>
                  )}

                  {/* Separator */}
                  {favoriteEntries.length > 0 && remainingModelsList.length > 0 && (
                    <div className="border-t border-white/10 my-1" />
                  )}

                  {/* All Models Section */}
                  <div className="p-1">
                    <div className="px-2 py-1 text-xs font-medium text-white/60">All Models</div>
                    {remainingModelsList.length > 0 ? (
                      <div className="space-y-1">
                        {remainingModelsList.map((model) => renderModelItem(model, false))}
                      </div>
                    ) : (
                      <div className="p-2 text-sm text-white/50 text-center">No models found</div>
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
                <div className="text-sm text-white/50">No model selected</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}