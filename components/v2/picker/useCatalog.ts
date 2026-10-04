import { createContext, useCallback, useContext, useMemo } from "react";
import { useChat } from "@/context/ChatProvider";
import type { Model } from "@/types/models";
import { formatProviderLabel, useModelPricing } from "@/components/chat/model-selector/useModelPricing";
import { useDisabledProviders } from "@/hooks/useDisabledProviders";
import { getRequiredSatsForModel, normalizeBaseUrl } from "@/utils/modelUtils";
import { loadLastUsedModel } from "@/utils/storageUtils";
import { webSearchModels } from "@/lib/preconfiguredModels";
import { discoveryAdapter } from "@/sdk/sharedStore";
import { useMoney } from "../useMoney";
import { textOf } from "../format";
import { estimateSats, promptTokens } from "../price";
import { answers, parseKey, priceScale, type Route, type Row } from "./catalog";

/** Development only: the lab hands the picker a catalogue with providers, so
 *  every state can be seen without touching the real provider cache. */
export interface CatalogStandIn {
  routes: (id: string) => Route[];
  picks: string[];
  currentKey: string | null;
}
export const CatalogStandInContext = createContext<CatalogStandIn | null>(null);

const needOf = (m: Model) => {
  try {
    return getRequiredSatsForModel(m) || 0;
  } catch {
    return 0;
  }
};

/** Everything the picker reads, in one place: models, who serves them, what a
 *  message costs on each, what you can afford, what is in use. */
export function useCatalog() {
  const chat = useChat();
  const standIn = useContext(CatalogStandInContext);
  const money = useMoney();
  const { disabledProviders } = useDisabledProviders();
  const pricing = useModelPricing({
    models: chat.models,
    disabledProviders,
    modelProviderMap: chat.modelProviderMap,
    configuredModels: chat.configuredModels,
    selectedModel: chat.selectedModel,
  });

  // the same estimate the composer shows: this conversation plus the draft
  const history = useMemo(() => chat.messages.map((m) => textOf(m.content)).join(" "), [chat.messages]);
  const tokens = useMemo(() => promptTokens(history, chat.inputMessage), [history, chat.inputMessage]);
  const cost = useCallback((m: Model | null | undefined) => estimateSats(m, tokens), [tokens]);

  const models = useMemo(() => chat.models.filter(answers), [chat.models]);
  // the pricing object is new each render; its callbacks are stable
  const { getProviderPricingEntries, getCachedModelFor } = pricing;

  // cheapest first, the order the router tries them in
  const routesById = useMemo(() => {
    const map = new Map<string, Route[]>();
    for (const m of models) {
      map.set(
        m.id,
        standIn
          ? standIn.routes(m.id)
          : getProviderPricingEntries(m.id).map((e) => ({
              base: e.baseUrl,
              host: formatProviderLabel(e.baseUrl, e.model),
              model: e.model,
            }))
      );
    }
    return map;
  }, [models, getProviderPricingEntries, standIn]);
  const routesOf = useCallback((id: string) => routesById.get(id) ?? [], [routesById]);
  // every provider that serves at least one of these models, for "Only from"
  const hosts = useMemo(() => {
    const seen = new Map<string, string>();
    routesById.forEach((rs) => rs.forEach((r) => seen.set(r.base, r.host)));
    return [...seen].map(([base, host]) => ({ base, host })).sort((a, b) => a.host.localeCompare(b.host));
  }, [routesById]);

  /** The provider a row speaks for: its pin, the "Only from" host, or the
   *  cheapest. A pin whose provider is gone resolves to what that provider
   *  last listed, never to someone else's price. */
  const routeFor = useCallback(
    (row: Row, host: string | null = null, only: string | null = null): Route => {
      const rs = routesOf(row.model.id);
      const want = host ?? row.pin ?? only;
      const hit = want ? rs.find((r) => r.base === want) : rs[0];
      if (hit) return hit;
      if (want && !standIn) {
        const cached = getCachedModelFor(want, row.model.id);
        if (cached) return { base: want, host: formatProviderLabel(want, cached), model: cached };
      }
      return rs[0] ?? { base: "", host: formatProviderLabel(null, row.model), model: row.model };
    },
    [routesOf, getCachedModelFor, standIn]
  );

  const balance = money.total;
  const needFor = useCallback((m: Model) => (money.node ? 0 : needOf(m)), [money.node]);
  const fits = useCallback((m: Model) => {
    const n = needFor(m);
    return n <= 0 || balance >= n;
  }, [needFor, balance]);

  const scale = useMemo(
    () => priceScale(models.map((m) => cost(routesOf(m.id)[0]?.model ?? m))),
    [models, routesOf, cost]
  );

  const picks = useMemo(
    () => new Set(standIn ? standIn.picks : discoveryAdapter.getRoutstr21Models()),
    // the discovery store hydrates late; re-read it whenever models change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [standIn, chat.models]
  );
  const web = useMemo(() => new Set(webSearchModels), []);

  // which provider the model in use is pinned to, if any
  const currentKey = standIn ? standIn.currentKey : loadLastUsedModel();
  const current = useMemo(() => {
    const id = chat.selectedModel?.id ?? null;
    const k = currentKey ? parseKey(currentKey) : null;
    const pin = k && k.id === id && k.base ? normalizeBaseUrl(k.base) || null : null;
    return { id, pin };
  }, [chat.selectedModel?.id, currentKey]);

  // one object per real change, so memoised rows and details can hold still
  return useMemo(
    () => ({ models, routesOf, routeFor, cost, needFor, fits, scale, picks, web, current, balance, node: money.node, hosts }),
    [models, routesOf, routeFor, cost, needFor, fits, scale, picks, web, current, balance, money.node, hosts]
  );
}

export type Catalog = ReturnType<typeof useCatalog>;
