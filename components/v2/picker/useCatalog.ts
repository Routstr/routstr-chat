import { createContext, useCallback, useContext, useMemo } from "react";
import { useOpenChat } from "../openChat";
import { useCatalogService } from "@/features/catalog/view";
import { useThread } from "@/features/history/view";
import type { Model } from "@/types/models";
import { getRequiredSatsForModel } from "@/utils/modelUtils";
import { webSearchModels } from "@/lib/preconfiguredModels";
import { keyOf } from "../pick";
import { useDraft } from "../ui";
import { useChatModel } from "../useChatModel";
import { useMoney } from "../useMoney";
import { textOf } from "../format";
import { estimateSats, promptTokens } from "../price";
import { answers, baseKey, hostOf, parseKey, priceScale, type Route, type Row } from "./catalog";

/** Development only: the lab hands the picker a catalogue with providers, so
 *  every state can be seen without touching the real provider cache. */
export interface CatalogStandIn {
  routes: (id: string) => Route[];
  picks: string[];
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
  const catalog = useCatalogService();
  const { models: all, model: selectedModel, chosen } = useChatModel();
  const slots = useThread(useOpenChat().id);
  const { text } = useDraft();
  const standIn = useContext(CatalogStandInContext);
  const money = useMoney();

  // the same estimate the composer shows: this conversation plus the draft
  const history = useMemo(() => (slots ?? []).map((s) => textOf(s.displayed.content)).join(" "), [slots]);
  const tokens = useMemo(() => promptTokens(history, text), [history, text]);
  const cost = useCallback((m: Model | null | undefined) => estimateSats(m, tokens), [tokens]);

  const models = useMemo(() => all.filter(answers), [all]);

  // cheapest first, the order the router tries them in. Ranking rescans the
  // whole discovery cache, so each model is ranked once per change of the list.
  const routesById = useMemo(() => {
    const rank = (id: string): Route[] =>
      standIn
        ? standIn.routes(id)
        : (catalog?.routes(id) ?? []).map((r) => {
            const model = r.model as unknown as Model;
            return { base: baseKey(r.baseUrl), host: hostOf(r.baseUrl, model), model };
          });
    return new Map(models.map((m) => [m.id, rank(m.id)]));
  }, [models, catalog, standIn]);
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
        const listed = catalog?.listedAt(want, row.model.id);
        if (listed) return { base: want, host: hostOf(want, listed), model: listed };
      }
      return rs[0] ?? { base: "", host: hostOf(null, row.model), model: row.model };
    },
    [routesOf, catalog, standIn]
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
    () => new Set(standIn ? standIn.picks : catalog?.picks() ?? []),
    // the discovery store hydrates late; re-read it whenever models change
    [standIn, catalog, all]
  );
  const web = useMemo(() => new Set(webSearchModels), []);

  // which provider the model in use is pinned to, if any
  const currentKey = chosen && keyOf(chosen);
  const current = useMemo(() => {
    const id = selectedModel?.id ?? null;
    const k = currentKey ? parseKey(currentKey) : null;
    const pin = k && k.id === id && k.base ? baseKey(k.base) : null;
    return { id, pin };
  }, [selectedModel?.id, currentKey]);

  // one object per real change, so memoised rows and details can hold still
  return useMemo(
    () => ({ models, routesOf, routeFor, cost, needFor, fits, scale, picks, web, current, balance, node: money.node, hosts }),
    [models, routesOf, routeFor, cost, needFor, fits, scale, picks, web, current, balance, money.node, hosts]
  );
}

export type Catalog = ReturnType<typeof useCatalog>;
