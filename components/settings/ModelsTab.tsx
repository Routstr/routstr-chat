'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search, Check, XCircle, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Model } from '@/data/models';
import { getModelNameWithoutProvider } from '@/data/models';

type ProviderItem = { name: string; endpoint_url: string; endpoint_urls?: string[] };

interface ModelsTabProps {
  models: readonly Model[];
  configuredModels: string[];
  toggleConfiguredModel: (modelId: string) => void;
  setConfiguredModels?: (models: string[]) => void;
  modelProviderMap?: Record<string, string>;
  setModelProviderFor?: (modelId: string, baseUrl: string) => void;
}

const ModelsTab: React.FC<ModelsTabProps> = ({
  models,
  configuredModels,
  toggleConfiguredModel,
  setConfiguredModels,
  modelProviderMap = {},
  setModelProviderFor
}) => {
  // Search specific to provider models in "All Models" card
  const [providerSearchQuery, setProviderSearchQuery] = useState('');
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [providerModels, setProviderModels] = useState<readonly Model[]>([]);
  const [isLoadingProviderModels, setIsLoadingProviderModels] = useState(false);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        setIsLoadingProviders(true);
        const res = await fetch('https://api.routstr.com/v1/providers/');
        if (!res.ok) throw new Error('Failed to fetch providers');
        const data = await res.json();
        const list: ProviderItem[] = (data?.providers ?? []).map((p: any) => ({
          name: p.name || p.endpoint_url,
          endpoint_url: p.endpoint_url,
          endpoint_urls: p.endpoint_urls
        }));
        // Prioritize api.routstr.com as first
        const preferred = 'api.routstr.com';
        const prioritized = list.slice().sort((a: ProviderItem, b: ProviderItem) => {
          const aMatch = (a.endpoint_url && a.endpoint_url.includes(preferred)) || (a.endpoint_urls || []).some((u: string) => u.includes(preferred)) ? 0 : 1;
          const bMatch = (b.endpoint_url && b.endpoint_url.includes(preferred)) || (b.endpoint_urls || []).some((u: string) => u.includes(preferred)) ? 0 : 1;
          return aMatch - bMatch;
        });
        setProviders(prioritized);

        // Default selection: api.routstr.com if available; otherwise first entry
        if (prioritized.length > 0 && !selectedProvider) {
          const preferredEntry = prioritized.find((p: ProviderItem) => (p.endpoint_url && p.endpoint_url.includes(preferred)) || (p.endpoint_urls || []).some((u: string) => u.includes(preferred)));
          const baseUrlRaw = preferredEntry?.endpoint_url || prioritized[0].endpoint_url;
          const primary = baseUrlRaw?.startsWith('http') ? baseUrlRaw : `https://${baseUrlRaw}`;
          setSelectedProvider(primary.endsWith('/') ? primary : `${primary}/`);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoadingProviders(false);
      }
    };
    void fetchProviders();
  }, []);

  useEffect(() => {
    const fetchProviderModels = async () => {
      if (!selectedProvider) return;
      try {
        setIsLoadingProviderModels(true);
        const base = selectedProvider.endsWith('/') ? selectedProvider : `${selectedProvider}/`;
        const res = await fetch(`${base}v1/models`);
        if (!res.ok) throw new Error('Failed to fetch models for provider');
        const data = await res.json();
        const list = (data?.data ?? []) as readonly Model[];
        setProviderModels(list);
      } catch (e) {
        console.error(e);
        setProviderModels([]);
      } finally {
        setIsLoadingProviderModels(false);
      }
    };
    void fetchProviderModels();
  }, [selectedProvider]);

  // Helpers to work with provider-qualified model keys: `${modelId}@@${baseUrl}`
  const normalizeBaseUrl = (base: string): string => {
    if (!base) return '';
    const primary = base.startsWith('http') ? base : `https://${base}`;
    return primary.endsWith('/') ? primary : `${primary}/`;
  };

  const buildModelKey = (modelId: string, baseUrl: string): string => {
    const normalized = normalizeBaseUrl(baseUrl);
    return `${modelId}@@${normalized}`;
  };

  const parseModelKey = (key: string): { id: string; base: string | null } => {
    const sep = key.indexOf('@@');
    if (sep === -1) return { id: key, base: null };
    return { id: key.slice(0, sep), base: key.slice(sep + 2) };
  };

  // Build configured list: each favorite is a specific (id, provider) pair if encoded
  const configuredModelsList = useMemo(() => {
    // Map over configured keys -> { key, id, base, model }
    return configuredModels.map((key) => {
      const { id, base } = parseModelKey(key);
      const model = models.find(m => m.id === id);
      return { key, id, base, model } as { key: string; id: string; base: string | null; model: Model | undefined };
    }).filter(item => !!item.model);
  }, [models, configuredModels]);

  const clearAll = () => {
    if (setConfiguredModels) setConfiguredModels([]);
  };

  const getProviderLabelFor = (modelKeyOrId: string): string => {
    const parsed = parseModelKey(modelKeyOrId);
    const base = parsed.base || modelProviderMap[modelKeyOrId] || modelProviderMap[parsed.id];
    if (!base) return 'System default';
    try {
      const match = providers.find(pr => {
        const primary = pr.endpoint_url?.startsWith('http') ? pr.endpoint_url : `https://${pr.endpoint_url}`;
        const normalized = primary.endsWith('/') ? primary : `${primary}/`;
        return normalized === base;
      });
      return match ? `${match.name} — ${base}` : base;
    } catch {
      return base;
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="bg-white/5 border border-white/10 rounded-md p-3 h-full flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-white flex items-center gap-1.5">
              Favorite Models
            </h4>
            {configuredModels.length > 0 && (
              <button
                className="text-white/50 hover:text-red-400 text-xs flex items-center gap-1 cursor-pointer"
                onClick={clearAll}
                type="button"
              >
                <XCircle className="h-3 w-3" /> Clear all
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/5">
            {configuredModelsList.length > 0 ? configuredModelsList.map(item => (
              <div key={item.key} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 text-yellow-400 flex-shrink-0">
                      <path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.401 8.167L12 18.896l-7.335 3.868 1.401-8.167L.132 9.21l8.2-1.192L12 .587z"/>
                    </svg>
                    <span className="truncate">{item.model ? getModelNameWithoutProvider(item.model.name) : item.id}</span>
                  </div>
                  <div className="text-[11px] text-white/50 truncate">{item.id}</div>
                  <div className="text-[11px] text-white/60 truncate">
                    Provider: <span className="text-white/80">{getProviderLabelFor(item.key)}</span>
                  </div>
                </div>
                <button
                  className="text-white/50 hover:text-red-400 text-xs cursor-pointer"
                  onClick={() => toggleConfiguredModel(item.key)}
                  title="Remove from My Models"
                  type="button"
                >
                  Remove
                </button>
              </div>
            )) : (
              <div className="text-sm text-white/50 py-4 text-center">No models selected. Add from the list →</div>
            )}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-md p-3 h-full flex flex-col min-h-0">
          <h4 className="text-sm font-medium text-white mb-2">All Models</h4>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] text-white/60 flex-shrink-0">Provider</span>
            {isLoadingProviders ? (
              <div className="inline-block align-middle">
                <div className="h-6 w-56 bg-white/5 border border-white/10 rounded animate-pulse" />
              </div>
            ) : providers.length > 0 ? (
              <div className="flex-1 min-w-0">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 cursor-pointer w-full justify-between"
                      type="button"
                    >
                      <span className="truncate text-left">
                        {(() => {
                          const p = providers.find(pr => {
                            const primary = pr.endpoint_url?.startsWith('http') ? pr.endpoint_url : `https://${pr.endpoint_url}`;
                            const normalized = primary.endsWith('/') ? primary : `${primary}/`;
                            return normalized === selectedProvider;
                          });
                          return p ? `${p.name} — ${selectedProvider}` : selectedProvider || 'Select provider';
                        })()}
                      </span>
                      <ChevronDown className="h-3 w-3 text-white/60 flex-shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="bg-black border-white/10 text-white p-2 w-96">
                    <div className="mb-2 relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                      <input
                        placeholder="Search providers..."
                        className="w-full bg-white/5 border border-white/10 rounded pl-8 pr-2 py-1 text-xs text-white focus:border-white/30 focus:outline-none"
                        onChange={(e) => {
                          const q = e.target.value.toLowerCase();
                          setProviders(prev => prev.slice().sort((a, b) => {
                            const an = (a.name || a.endpoint_url).toLowerCase();
                            const bn = (b.name || b.endpoint_url).toLowerCase();
                            const am = an.includes(q) ? 0 : 1;
                            const bm = bn.includes(q) ? 0 : 1;
                            return am - bm || an.localeCompare(bn);
                          }));
                        }}
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {providers.map((p) => {
                        const primary = p.endpoint_url?.startsWith('http') ? p.endpoint_url : `https://${p.endpoint_url}`;
                        const normalized = primary.endsWith('/') ? primary : `${primary}/`;
                        const isActive = normalized === selectedProvider;
                        return (
                          <button
                            key={`${p.name}-${normalized}`}
                            className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-white/10 cursor-pointer ${isActive ? 'bg-white/10' : ''}`}
                            onClick={() => setSelectedProvider(normalized)}
                            type="button"
                          >
                            <div className="truncate">
                              <span className="text-white/90">{p.name}</span>
                              <span className="text-white/40"> — {normalized}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ) : (
              <span className="text-[11px] text-white/50">No providers available</span>
            )}
          </div>
          {/* Provider models search */}
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
            <input
              placeholder="Search models in this provider..."
              className="w-full bg-white/5 border border-white/10 rounded pl-8 pr-2 py-1.5 text-sm text-white focus:border-white/30 focus:outline-none"
              value={providerSearchQuery}
              onChange={(e) => setProviderSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/5">
            {isLoadingProviders || isLoadingProviderModels ? (
              <div className="p-2 space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="py-2">
                    <div className="h-4 w-40 bg-white/5 rounded animate-pulse mb-1" />
                    <div className="h-3 w-64 bg-white/5 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : providerModels.filter(m => {
              const q = providerSearchQuery.toLowerCase();
              return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
            }).length > 0 ? providerModels.filter(m => {
              const q = providerSearchQuery.toLowerCase();
              return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
            }).map(model => (
              <div key={`${selectedProvider}-${model.id}`} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{getModelNameWithoutProvider(model.name)}</div>
                  <div className="text-[11px] text-white/50 truncate">{model.id}</div>
                </div>
                <button
                  className="text-white/80 hover:text-white text-xs border border-white/20 rounded px-2 py-1 cursor-pointer flex items-center gap-1"
                  onClick={() => {
                    const base = normalizeBaseUrl(selectedProvider);
                    const key = buildModelKey(model.id, base);
                    if (setModelProviderFor) {
                      // Store mapping for this specific provider-qualified key
                      setModelProviderFor(key, base);
                    }
                    toggleConfiguredModel(key);
                  }}
                  title="Favorite this model"
                  type="button"
                >
                  <Check className="h-3 w-3" /> Favorite
                </button>
              </div>
            )) : (
              <div className="text-sm text-white/50 py-4 text-center">No models found for this provider</div>
            )}
          </div>
        </div>
      </div>

      
    </div>
  );
};

export default ModelsTab;


