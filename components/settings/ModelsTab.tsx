"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Check, XCircle, ChevronDown, Minus, Star } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { Switch } from "@/components/ui/switch";
import { Model } from "@/types/models";
import {
  getModelNameWithoutProvider,
  normalizeBaseUrl as normalizeBaseUrlUtil,
  parseModelKey as parseModelKeyUtil,
  getCachedProviderModels,
  upsertCachedProviderModels,
} from "@/utils/modelUtils";
import {
  loadDisabledProviders,
  saveDisabledProviders,
} from "@/utils/storageUtils";

type ProviderItem = {
  name: string;
  endpoint_url: string;
  endpoint_urls?: string[];
};

interface ModelsTabProps {
  models: readonly Model[];
  configuredModels: string[];
  toggleConfiguredModel: (modelId: string) => void;
  setConfiguredModels?: (models: string[]) => void;
  modelProviderMap?: Record<string, string>;
  setModelProviderFor?: (modelId: string, baseUrl: string) => void;
  fetchModels?: (balance: number) => Promise<void>;
}

const ModelsTab: React.FC<ModelsTabProps> = ({
  models,
  configuredModels,
  toggleConfiguredModel,
  setConfiguredModels,
  modelProviderMap = {},
  setModelProviderFor,
  fetchModels,
}) => {
  // Search specific to provider models in "All Models" card
  const [providerSearchQuery, setProviderSearchQuery] = useState("");
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [allProviders, setAllProviders] = useState<ProviderItem[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [providerModels, setProviderModels] = useState<readonly Model[]>([]);
  const [isLoadingProviderModels, setIsLoadingProviderModels] = useState(false);
  const [isProviderPopoverOpen, setIsProviderPopoverOpen] = useState(false);
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);

  useEffect(() => {
    // Load disabled providers from localStorage
    setDisabledProviders(loadDisabledProviders());
  }, []);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        setIsLoadingProviders(true);
        const res = await fetch("https://api.routstr.com/v1/providers/");
        if (!res.ok) throw new Error("Failed to fetch providers");
        const data = await res.json();
        const list: ProviderItem[] = (data?.providers ?? []).map((p: any) => ({
          name: p.name || p.endpoint_url,
          endpoint_url: p.endpoint_url,
          endpoint_urls: p.endpoint_urls,
        }));
        // Filter out staging providers on production
        const isProduction =
          typeof window !== "undefined" &&
          window.location.hostname === "chat.routstr.com";
        let filteredList = isProduction
          ? list.filter((p) => !p.endpoint_url?.includes("staging"))
          : list;

        // Add localhost in development
        if (process.env.NODE_ENV === "development") {
          filteredList = [
            ...filteredList,
            {
              name: "Localhost",
              endpoint_url: "http://localhost:8000/",
            },
          ];
        }

        // Keep provided order; optionally alphabetical by name for UX
        const sorted = filteredList
          .slice()
          .sort((a, b) =>
            (a.name || a.endpoint_url).localeCompare(b.name || b.endpoint_url)
          );
        // Store all providers for Disable Providers section
        setAllProviders(sorted);
        // Filter out disabled providers for dropdown
        const disabled = loadDisabledProviders();
        const filtered = sorted.filter((p) => {
          const primary = p.endpoint_url?.startsWith("http")
            ? p.endpoint_url
            : `https://${p.endpoint_url}`;
          const normalized = primary.endsWith("/") ? primary : `${primary}/`;
          return !disabled.includes(normalized);
        });
        setProviders(filtered);

        // Default selection: first entry only (no special host preference)
        if (filtered.length > 0 && !selectedProvider) {
          const baseUrlRaw = filtered[0].endpoint_url;
          const primary = baseUrlRaw?.startsWith("http")
            ? baseUrlRaw
            : `https://${baseUrlRaw}`;
          setSelectedProvider(primary.endsWith("/") ? primary : `${primary}/`);
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
        const base = selectedProvider.endsWith("/")
          ? selectedProvider
          : `${selectedProvider}/`;
        const res = await fetch(`${base}v1/models`);
        if (!res.ok) throw new Error("Failed to fetch models for provider");
        const data = await res.json();
        const list = (data?.data ?? []) as readonly Model[];
        setProviderModels(list);
        // Persist into local cache for cross-tab use (e.g., favorites rendering)
        try {
          upsertCachedProviderModels(base, list as Model[]);
        } catch {}
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
  const normalizeBaseUrl = (base: string): string =>
    normalizeBaseUrlUtil(base) || "";

  const buildModelKey = (modelId: string, baseUrl: string): string => {
    const normalized = normalizeBaseUrl(baseUrl);
    return `${modelId}@@${normalized}`;
  };

  const parseModelKey = (key: string): { id: string; base: string | null } =>
    parseModelKeyUtil(key);

  // Build configured list: each favorite is a specific (id, provider) pair if encoded
  const configuredModelsList = useMemo(() => {
    // Map over configured keys -> { key, id, base, model }, falling back to cached provider models if not in main list
    return configuredModels.map((key) => {
      const { id, base } = parseModelKey(key);
      let model = models.find((m) => m.id === id);
      if (!model && base) {
        try {
          const cached = getCachedProviderModels(base);
          if (cached && Array.isArray(cached)) {
            model = cached.find((m) => m.id === id);
          }
        } catch {}
      }
      return { key, id, base, model } as {
        key: string;
        id: string;
        base: string | null;
        model: Model | undefined;
      };
    });
  }, [models, configuredModels]);

  const clearAll = () => {
    if (setConfiguredModels) setConfiguredModels([]);
  };

  const getProviderLabelFor = (modelKeyOrId: string): string => {
    const parsed = parseModelKey(modelKeyOrId);
    const base =
      parsed.base ||
      modelProviderMap[modelKeyOrId] ||
      modelProviderMap[parsed.id];
    if (!base) return "System default";
    try {
      const match = providers.find((pr) => {
        const primary = pr.endpoint_url?.startsWith("http")
          ? pr.endpoint_url
          : `https://${pr.endpoint_url}`;
        const normalized = primary.endsWith("/") ? primary : `${primary}/`;
        return normalized === base;
      });
      return match ? `${match.name} — ${base}` : base;
    } catch {
      return base;
    }
  };

  const normalizeProviderUrl = (endpointUrl: string): string => {
    const primary = endpointUrl?.startsWith("http")
      ? endpointUrl
      : `https://${endpointUrl}`;
    return primary.endsWith("/") ? primary : `${primary}/`;
  };

  const toggleProviderDisabled = (providerUrl: string) => {
    const normalized = normalizeProviderUrl(providerUrl);
    setDisabledProviders((prev) => {
      const isDisabled = prev.includes(normalized);
      const updated = isDisabled
        ? prev.filter((url) => url !== normalized)
        : [...prev, normalized];
      saveDisabledProviders(updated);
      // Update filtered providers list
      const filtered = allProviders.filter((p) => {
        const primary = p.endpoint_url?.startsWith("http")
          ? p.endpoint_url
          : `https://${p.endpoint_url}`;
        const normalizedUrl = primary.endsWith("/") ? primary : `${primary}/`;
        return !updated.includes(normalizedUrl);
      });
      setProviders(filtered);
      return updated;
    });
    // Trigger fetchModels to refresh available models (after state update)
    if (fetchModels) {
      setTimeout(() => {
        fetchModels(0).catch((err) =>
          console.error("Failed to refresh models:", err)
        );
      }, 0);
    }
  };

  const isProviderDisabled = (providerUrl: string): boolean => {
    const normalized = normalizeProviderUrl(providerUrl);
    return disabledProviders.includes(normalized);
  };

  return (
    <div className="flex flex-col h-full min-h-[600px]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="flex flex-col gap-4 h-full">
          {/* Favorite Models Section - Top */}
          <div className="bg-muted/50 border border-border rounded-md p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-1.5">
                Favorite Models
              </h4>
              {configuredModels.length > 0 && (
                <button
                  className="text-muted-foreground hover:text-red-400 text-xs flex items-center gap-1 cursor-pointer"
                  onClick={clearAll}
                  type="button"
                >
                  <XCircle className="h-3 w-3" /> Clear all
                </button>
              )}
            </div>
            <div className="overflow-y-auto divide-y divide-border max-h-[200px]">
              {configuredModelsList.length > 0 ? (
                configuredModelsList.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-foreground truncate flex items-center gap-1.5">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="h-3.5 w-3.5 text-yellow-500 dark:text-yellow-400 shrink-0"
                        >
                          <path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.787 1.401 8.167L12 18.896l-7.335 3.868 1.401-8.167L.132 9.21l8.2-1.192L12 .587z" />
                        </svg>
                        <span className="truncate">
                          {item.model
                            ? getModelNameWithoutProvider(item.model.name)
                            : item.id}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        Provider:{" "}
                        <span className="text-foreground/80">
                          {getProviderLabelFor(item.key)}
                        </span>
                      </div>
                    </div>
                    <button
                      className="text-muted-foreground hover:text-red-400 text-xs cursor-pointer"
                      onClick={() => toggleConfiguredModel(item.key)}
                      title="Remove from My Models"
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  No models selected. Add from the list →
                </div>
              )}
            </div>
          </div>

          {/* Disable Providers Section - Bottom */}
          <div className="bg-muted/50 border border-border rounded-md p-3 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                Providers
                <span className="text-xs font-normal text-muted-foreground">
                  ({allProviders.length - disabledProviders.length}/
                  {allProviders.length})
                </span>
              </h4>
              {allProviders.length > 0 && (
                <Switch
                  checked={disabledProviders.length === 0}
                  onCheckedChange={() => {
                    const shouldEnableAll = disabledProviders.length > 0;
                    if (shouldEnableAll) {
                      // Enable all providers
                      setDisabledProviders([]);
                      saveDisabledProviders([]);
                      setProviders(allProviders);
                    } else {
                      // Disable all providers
                      const allDisabled = allProviders.map((p) =>
                        normalizeProviderUrl(p.endpoint_url)
                      );
                      setDisabledProviders(allDisabled);
                      saveDisabledProviders(allDisabled);
                      setProviders([]);
                    }
                    // Trigger fetchModels to refresh available models (after state update)
                    if (fetchModels) {
                      setTimeout(() => {
                        fetchModels(0).catch((err) =>
                          console.error("Failed to refresh models:", err)
                        );
                      }, 0);
                    }
                  }}
                  id="toggle-all-providers"
                  aria-label={
                    disabledProviders.length === 0
                      ? "Disable all providers"
                      : disabledProviders.length === allProviders.length
                        ? "Enable all providers"
                        : `Enable all providers (${
                            allProviders.length - disabledProviders.length
                          }/${allProviders.length} enabled)`
                  }
                />
              )}
            </div>
            <div className="overflow-y-auto divide-y divide-border flex-1 min-h-0">
              {isLoadingProviders ? (
                <div className="p-2 space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="py-2">
                      <div className="h-4 w-32 bg-muted rounded animate-pulse mb-1" />
                      <div className="h-3 w-48 bg-muted rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : allProviders.length > 0 ? (
                allProviders.map((provider) => {
                  const normalized = normalizeProviderUrl(
                    provider.endpoint_url
                  );
                  const isDisabled = isProviderDisabled(provider.endpoint_url);
                  if (normalized.includes("http://")) return null;
                  return (
                    <div
                      key={`${provider.name}-${normalized}`}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-foreground truncate">
                          {provider.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {normalized}
                        </div>
                      </div>
                      <Switch
                        checked={!isDisabled}
                        onCheckedChange={() =>
                          toggleProviderDisabled(provider.endpoint_url)
                        }
                        id={`switch-${normalized}`}
                        aria-label={
                          isDisabled ? "Enable provider" : "Disable provider"
                        }
                      />
                    </div>
                  );
                })
              ) : (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  No providers available
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-muted/50 border border-border rounded-md p-3 flex flex-col h-[500px] md:h-full min-h-0">
          <h4 className="text-sm font-medium text-foreground mb-2">
            All Models
          </h4>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground shrink-0">
              Provider
            </span>
            {isLoadingProviders ? (
              <div className="inline-block align-middle">
                <div className="h-6 w-56 bg-muted border border-border rounded animate-pulse" />
              </div>
            ) : providers.length > 0 ? (
              <div className="flex-1 min-w-0">
                <Popover
                  open={isProviderPopoverOpen}
                  onOpenChange={setIsProviderPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <button
                      className="inline-flex items-center gap-1 bg-muted/50 border border-border rounded px-2 py-1 text-[11px] text-foreground/80 hover:bg-muted cursor-pointer w-full justify-between"
                      type="button"
                    >
                      <span className="truncate text-left">
                        {(() => {
                          const p = providers.find((pr) => {
                            const primary = pr.endpoint_url?.startsWith("http")
                              ? pr.endpoint_url
                              : `https://${pr.endpoint_url}`;
                            const normalized = primary.endsWith("/")
                              ? primary
                              : `${primary}/`;
                            return normalized === selectedProvider;
                          });
                          return p
                            ? `${p.name} — ${selectedProvider}`
                            : selectedProvider || "Select provider";
                        })()}
                      </span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="bg-card border border-border text-foreground p-2 w-[calc(100vw-40px)] sm:w-96 rounded-md shadow-lg z-[9999]"
                  >
                    <div className="mb-2 relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        placeholder="Search providers..."
                        className="w-full bg-muted/50 border border-border rounded pl-8 pr-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
                        onChange={(e) => {
                          const q = e.target.value.toLowerCase();
                          setProviders((prev) =>
                            prev.slice().sort((a, b) => {
                              const an = (
                                a.name || a.endpoint_url
                              ).toLowerCase();
                              const bn = (
                                b.name || b.endpoint_url
                              ).toLowerCase();
                              const am = an.includes(q) ? 0 : 1;
                              const bm = bn.includes(q) ? 0 : 1;
                              return am - bm || an.localeCompare(bn);
                            })
                          );
                        }}
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {providers.map((p) => {
                        const primary = p.endpoint_url?.startsWith("http")
                          ? p.endpoint_url
                          : `https://${p.endpoint_url}`;
                        const normalized = primary.endsWith("/")
                          ? primary
                          : `${primary}/`;
                        const isActive = normalized === selectedProvider;
                        if (normalized.includes("http://")) return null;
                        return (
                          <button
                            key={`${p.name}-${normalized}`}
                            className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-muted cursor-pointer ${
                              isActive ? "bg-muted" : ""
                            }`}
                            onClick={() => {
                              setSelectedProvider(normalized);
                              setIsProviderPopoverOpen(false);
                            }}
                            type="button"
                          >
                            <div className="truncate">
                              <span className="text-foreground/90">
                                {p.name}
                              </span>
                              <span className="text-muted-foreground">
                                {" "}
                                — {normalized}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                No providers available
              </span>
            )}
          </div>
          {/* Provider models search */}
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              placeholder="Search models in this provider..."
              className="w-full bg-muted/50 border border-border rounded pl-8 pr-2 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none"
              value={providerSearchQuery}
              onChange={(e) => setProviderSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border">
            {isLoadingProviders || isLoadingProviderModels ? (
              <div className="p-2 space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="py-2">
                    <div className="h-4 w-40 bg-muted rounded animate-pulse mb-1" />
                    <div className="h-3 w-64 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : providerModels.filter((m) => {
                const q = providerSearchQuery.toLowerCase();
                return (
                  m.name.toLowerCase().includes(q) ||
                  m.id.toLowerCase().includes(q)
                );
              }).length > 0 ? (
              providerModels
                .filter((m) => {
                  const q = providerSearchQuery.toLowerCase();
                  return (
                    m.name.toLowerCase().includes(q) ||
                    m.id.toLowerCase().includes(q)
                  );
                })
                .map((model) => {
                  const base = normalizeBaseUrl(selectedProvider);
                  const key = buildModelKey(model.id, base);
                  const isFav = configuredModels.includes(key);
                  return (
                    <div
                      key={`${selectedProvider}-${model.id}`}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-foreground truncate">
                          {getModelNameWithoutProvider(model.name)}
                        </div>
                      </div>
                      <button
                        className={`shrink-0 p-1 rounded transition-colors cursor-pointer ${
                          isFav
                            ? "text-yellow-500 hover:text-yellow-400"
                            : "text-muted-foreground hover:text-yellow-500"
                        }`}
                        onClick={() => {
                          if (setModelProviderFor) {
                            // Store mapping for this specific provider-qualified key
                            setModelProviderFor(key, base);
                          }
                          toggleConfiguredModel(key);
                        }}
                        title={
                          isFav ? "Remove from favorites" : "Add to favorites"
                        }
                        type="button"
                      >
                        <Star
                          className={`h-4 w-4 ${isFav ? "fill-current" : ""}`}
                        />
                      </button>
                    </div>
                  );
                })
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No models found for this provider
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelsTab;
