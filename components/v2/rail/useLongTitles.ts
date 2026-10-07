import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { groupByDay } from "../format";

/* ── titles: cut ones fade. Measured after the list is painted, and only the
   rows that are new or changed: a new chat opening never lays the whole
   list out again inside its commit. A width change measures them all. ── */
export function useLongTitles(
  listRef: RefObject<HTMLElement | null>,
  groups: ReturnType<typeof groupByDay>,
  activeConversationId: string | null,
  phone: boolean
) {
  const [long, setLong] = useState<Set<string>>(new Set());
  // each row as last measured: its title and the row it was drawn as
  const seen = useRef(new Map<string, { key: string; long: boolean }>());
  const measure = useCallback(() => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>(".sb-row") ?? []);
    for (const r of rows) {
      const t = r.querySelector<HTMLElement>(".sb-t");
      const key = `${t?.textContent ?? ""}|${r.className}`;
      if (seen.current.get(r.dataset.id!)?.key === key) continue;
      seen.current.set(r.dataset.id!, { key, long: !!t && t.scrollWidth > t.clientWidth - 34 });
    }
    const out = new Set(rows.filter((r) => seen.current.get(r.dataset.id!)?.long).map((r) => r.dataset.id!));
    setLong((s) => (s.size === out.size && [...out].every((x) => s.has(x)) ? s : out));
  }, []);
  const again = useCallback(() => {
    seen.current.clear();
    measure();
  }, [measure]);
  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [groups, activeConversationId, measure]);
  useEffect(() => {
    const raf = requestAnimationFrame(again);
    return () => cancelAnimationFrame(raf);
  }, [phone, again]);
  useEffect(() => {
    void document.fonts?.ready.then(again);
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, [again]);
  return long;
}
