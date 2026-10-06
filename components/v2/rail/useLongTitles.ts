import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { groupByDay } from "../format";

/* ── titles: cut ones fade; measured once per render of the list ────── */
export function useLongTitles(
  list: RefObject<HTMLElement | null>,
  groups: ReturnType<typeof groupByDay>,
  activeConversationId: string | null,
  phone: boolean
) {
  const [long, setLong] = useState<Set<string>>(new Set());
  const measure = useCallback(() => {
    const out = new Set<string>();
    list.current?.querySelectorAll<HTMLElement>(".sb-row").forEach((r) => {
      const t = r.querySelector<HTMLElement>(".sb-t");
      if (t && t.scrollWidth > t.clientWidth - 34) out.add(r.dataset.id!);
    });
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
