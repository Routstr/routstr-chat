import { useCallback, useMemo, useState } from "react";
import type { useChat } from "@/context/ChatProvider";
import { getCompanyMeta } from "@/components/v2/picker/modelCompanies";
import { normalizeBaseUrl } from "@/utils/modelUtils";
import type { Catalog } from "./useCatalog";
import type { Filters } from "./helpers";
import { draws, isPrivate, makerOf, measureFor, parseKey, searchRank, sortRows, type Row, type Scope, type SortKey } from "./catalog";

export interface Section {
  title: string;
  rows: Row[];
}

export function useSections({
  chat,
  cat,
  q,
  f,
  only,
  sort,
  dir,
  scope,
}: {
  chat: ReturnType<typeof useChat>;
  cat: Catalog;
  q: string;
  f: Filters;
  only: string | null;
  sort: SortKey;
  dir: 1 | -1;
  scope: Scope;
}) {
  /* ── rows ───────────────────────────────────────────────────────────── */
  const favKeys = chat.configuredModels;
  const favIds = useMemo(() => new Set(favKeys.map((k) => parseKey(k).id)), [favKeys]);
  // the list is grouped as it was when the picker opened: starring fills the
  // star in place and the row only moves on the next open
  const [groupKeys] = useState(() => chat.configuredModels);
  const groupIds = useMemo(() => new Set(groupKeys.map((k) => parseKey(k).id)), [groupKeys]);
  const byId = useMemo(() => new Map(cat.models.map((m) => [m.id, m])), [cat.models]);
  const rowsOf = useCallback(
    (keys: string[]) =>
      keys.flatMap((key): Row[] => {
        const { id, base } = parseKey(key);
        const model = byId.get(id);
        return model ? [{ key, model, pin: base ? normalizeBaseUrl(base) || null : null }] : [];
      }),
    [byId]
  );
  const favRows = useMemo(() => rowsOf(groupKeys), [rowsOf, groupKeys]);
  // the Favorites view is live: a new star joins it at once, and one taken
  // off stays listed (with an empty star) until the next open
  const liveFavs = useMemo(() => rowsOf(favKeys), [rowsOf, favKeys]);
  const favScope = useMemo(() => {
    const had = new Set(groupKeys);
    return [...favRows, ...liveFavs.filter((r) => !had.has(r.key))];
  }, [favRows, liveFavs, groupKeys]);

  const makerLabel = useCallback((id: string) => getCompanyMeta(id).label, []);
  const routeOf = useCallback((r: Row) => cat.routeFor(r, null, only), [cat, only]);
  const priceOf = useCallback((r: Row) => cat.cost(routeOf(r).model), [cat, routeOf]);
  const searching = q.trim().length > 0;
  const filtering = searching || f.fits || f.web || f.priv || f.images || !!only;

  const sections = useMemo<Section[]>(() => {
    const rank = (r: Row) => searchRank(r.model, makerLabel(makerOf(r.model)), q);
    const pass = (r: Row) => {
      const m = r.model;
      if (searching && !rank(r)) return false;
      if (f.web && !cat.web.has(m.id)) return false;
      if (f.priv && !isPrivate(m)) return false;
      if (f.images && !draws(m)) return false;
      if (only) {
        if (r.pin ? r.pin !== only : !cat.routesOf(m.id).some((x) => x.base === only)) return false;
      }
      if (f.fits && !cat.fits(routeOf(r).model)) return false;
      return true;
    };
    const measure = measureFor(sort, priceOf, (id) => cat.routesOf(id).length);
    const order = (rows: Row[]) => {
      const sorted = sortRows(rows, sort, dir, measure);
      if (!searching) return sorted;
      // while searching, how well it matches comes first; the sort breaks ties
      const pos = new Map(sorted.map((r, i) => [r.key, i]));
      return sorted.sort((a, b) => rank(b) - rank(a) || pos.get(a.key)! - pos.get(b.key)!);
    };
    if (scope === "favorites" && !searching) return [{ title: "Favorites", rows: order(favScope.filter(pass)) }];
    const inScope = (id: string) =>
      searching || scope === "all" || (scope === "picks" ? cat.picks.has(id) : makerOf(byId.get(id)!) === scope);
    let rest = cat.models.filter((m) => inScope(m.id)).map((m) => ({ key: m.id, model: m, pin: null }) as Row).filter(pass);
    if (scope === "all" && !filtering) {
      const out: Section[] = [];
      const favs = favRows.filter(pass);
      if (favs.length) out.push({ title: "Favorites", rows: order(favs) });
      rest = rest.filter((r) => !groupIds.has(r.model.id));
      out.push({ title: "All models", rows: order(rest) });
      return out;
    }
    const title = searching ? "Matches" : scope === "all" ? "All models" : scope === "picks" ? "Routstr picks" : makerLabel(scope);
    return [{ title, rows: order(rest) }];
  }, [cat, q, searching, f, only, sort, dir, scope, favRows, favScope, groupIds, byId, filtering, makerLabel, priceOf, routeOf]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const idxOf = useMemo(() => new Map(flat.map((r, i) => [r.key, i])), [flat]);
  // the row that stands for the model in use: its exact pin if listed,
  // otherwise the first row of that model (a favorite pinned elsewhere)
  const currentRowKey = useMemo(() => {
    const same = flat.filter((r) => r.model.id === cat.current.id);
    return (same.find((r) => (r.pin ?? null) === cat.current.pin) ?? same.find((r) => !r.pin) ?? same[0])?.key ?? null;
  }, [flat, cat.current]);
  const isCurrent = useCallback((r: Row) => r.key === currentRowKey, [currentRowKey]);
  const isFavRow = useCallback(
    (r: Row) => (r.pin ? favKeys.includes(r.key) : favIds.has(r.model.id)),
    [favKeys, favIds]
  );
  return { favKeys, favIds, liveFavs, makerLabel, routeOf, searching, filtering, sections, flat, idxOf, isCurrent, isFavRow };
}
