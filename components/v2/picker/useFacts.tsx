import React, { useMemo } from "react";
import type { Catalog } from "./useCatalog";
import { ctxK, draws, isPrivate, nameSaysPrivate, sees, type Row } from "./catalog";

export function useFacts(flat: Row[], cat: Catalog, routeOf: (r: Row) => ReturnType<Catalog["routeFor"]>, only: string | null) {
  const subOf = (r: Row): React.ReactNode[] => {
    const m = r.model;
    const bits: React.ReactNode[] = [];
    const host = r.pin;
    if (host) bits.push(<>on <span className="h">{cat.routeFor(r, host).host}</span></>);
    if (isPrivate(m) && !nameSaysPrivate(m)) bits.push("private");
    if (draws(m)) bits.push("makes images");
    else if (cat.web.has(m.id)) bits.push("searches the web");
    else if (sees(m) && bits.length < 1) bits.push("sees images");
    const ctx = Number(m.context_length ?? 0);
    if (bits.length < 2 && ctx >= 200000) bits.push(`${ctxK(ctx)} context`);
    const n = cat.routesOf(m.id).length;
    if (!host && !only && bits.length < 2 && n > 1) bits.push(`${n} providers`);
    return bits.slice(0, 2);
  };
  // what each row says, worked out once per list, not on every arrow key
  const facts = useMemo(
    () =>
      new Map(
        flat.map((r) => {
          const rt = routeOf(r);
          const ok = cat.fits(rt);
          return [
            r.key,
            {
              price: cat.cost(rt.model),
              short: !ok,
              sub: subOf(r),
            },
          ] as const;
        })
      ),
    [flat, cat, routeOf, only]
  );
  return facts;
}
