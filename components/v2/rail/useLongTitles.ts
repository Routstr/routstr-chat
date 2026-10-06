import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { groupByDay } from "../format";

/* ── titles: cut ones fade; measured once per render of the list ────── */
export function useLongTitles(
  listRef: RefObject<HTMLElement | null>,
  groups: ReturnType<typeof groupByDay>,
  activeConversationId: string | null,
  phone: boolean
) {
  const [long, setLong] = useState<Set<string>>(new Set());
  const measure = useCallback(() => {
    const out = new Set(
      Array.from(listRef.current?.querySelectorAll<HTMLElement>(".sb-row") ?? [])
        .filter((r) => {
          const t = r.querySelector<HTMLElement>(".sb-t");
          return t && t.scrollWidth > t.clientWidth - 34;
        })
        .map((r) => r.dataset.id!)
    );
    setLong((s) => (s.size === out.size && [...out].every((x) => s.has(x)) ? s : out));
  }, []);
  useLayoutEffect(measure, [groups, activeConversationId, phone, measure]);
  useEffect(() => {
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  return long;
}
