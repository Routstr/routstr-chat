import { useCallback, useMemo } from "react";
import { shortModelName } from "../format";
import type { Catalog } from "./useCatalog";
import type { Row } from "./catalog";

export function useDetail({
  detailKey,
  idxOf,
  flat,
  activeIdx,
  cat,
  draft,
  setDraft,
  only,
  push,
  toggleStar,
  choose,
  commit,
  say,
}: {
  detailKey: string | null;
  idxOf: Map<string, number>;
  flat: Row[];
  activeIdx: number;
  cat: Catalog;
  draft: { id: string; host: string | null } | null;
  setDraft: (d: { id: string; host: string | null } | null) => void;
  only: string | null;
  push: (v: "list" | "detail") => void;
  toggleStar: (r: Row) => void;
  choose: (r: Row, host?: string | null) => void;
  commit: (id: string, pin: string | null) => void;
  say: (t: string) => void;
}) {
  /* ── details for the active row ─────────────────────────────────────── */
  const dRow = detailKey !== null && idxOf.has(detailKey) ? flat[idxOf.get(detailKey)!] : flat[activeIdx] ?? null;
  const dHost = useMemo(() => {
    if (!dRow) return null;
    const id = dRow.model.id;
    if (id === cat.current.id) return cat.current.pin;
    if (draft && draft.id === id) return draft.host;
    return dRow.pin ?? (only && cat.routesOf(id).some((x) => x.base === only) ? only : null);
  }, [dRow, cat, draft, only]);
  const onBack = useCallback(() => push("list"), [push]);
  const onStar = useCallback(() => dRow && toggleStar(dRow), [dRow, toggleStar]);
  const onUse = useCallback(() => dRow && choose(dRow, dHost), [dRow, dHost, choose]);
  const onRoute = useCallback(
    (base: string | null) => {
      if (!dRow) return;
      const name = shortModelName(dRow.model.name, dRow.model.id);
      const hostName = base ? cat.routeFor(dRow, base).host : null;
      // the model in use switches at once; any other model only drafts it
      if (dRow.model.id === cat.current.id) {
        commit(dRow.model.id, base);
        say(hostName ? `${name} on ${hostName}` : `${name}, automatic provider`);
        return;
      }
      setDraft({ id: dRow.model.id, host: base });
      say(hostName ? `Use ${name} on ${hostName}, when you choose it` : `${name} on the automatic provider, when you choose it`);
    },
    [dRow, cat, commit, say]
  );
  return { dRow, dHost, onBack, onStar, onUse, onRoute };
}
