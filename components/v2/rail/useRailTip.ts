import { useRef, type RefObject } from "react";
import { sats } from "../format";
import type { useMoney } from "../useMoney";
import { phoneNow } from "./helpers";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const TRASH =
  '<svg class="v2-ico" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 4.5h4M7 7l.8 11a2 2 0 0 0 2 1.9h4.4a2 2 0 0 0 2-1.9L17 7"/></svg>';

/* ── the tip: a long title's rest, or a folded tool's name ──────────── */
export function useRailTip({
  root,
  tip: tipRef,
  list,
  folded,
  K,
  money,
}: {
  root: RefObject<HTMLElement | null>;
  tip: RefObject<HTMLDivElement | null>;
  list: RefObject<HTMLElement | null>;
  folded: boolean;
  K: (k: string, shift?: boolean) => string;
  money: ReturnType<typeof useMoney>;
}) {
  const tipTimer = useRef(0);
  const tipCool = useRef(0);
  const tipWarm = useRef(false);
  const tipFor = useRef<Element | null>(null);
  const hideTip = (now?: boolean) => {
    window.clearTimeout(tipTimer.current);
    root.current?.querySelectorAll(".sb-grp-t.is-under").forEach((n) => n.classList.remove("is-under"));
    tipRef.current?.classList.remove("is-on");
    tipFor.current = null;
    window.clearTimeout(tipCool.current);
    tipCool.current = window.setTimeout(() => (tipWarm.current = false), now ? 0 : 320);
  };
  const tips = (kind: string): [string, string] | null => {
    if (kind === "fold") return [folded ? "Show sidebar" : "Collapse sidebar", K("B")];
    if (kind === "new") return ["New chat", K("O", true)];
    if (kind === "find") return ["Search chats", K("K")];
    if (kind === "bal") return money.node ? ["Paying with your node", ""] : [`Wallet · ${sats(money.total)} sats`, ""];
    if (kind === "room") return [document.querySelector(".sb-sw")?.getAttribute("aria-label")?.split(".")[0] ?? "Room", ""];
    if (kind === "gear") return ["Settings", ""];
    return null;
  };
  const showTip = (el: HTMLElement, kind: string) => {
    const t = tipRef.current;
    const rail = root.current;
    if (!t || !rail) return;
    const rr = rail.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    tipFor.current = el;
    if (kind === "title") {
      // the row opens downward to show its whole title: same place, same type,
      // first line exactly over the row's own, so it reads as the row growing.
      // It draws the row's delete glyph at the spot of the real button under it.
      const go = el.querySelector<HTMLElement>(".sb-go")!;
      const gr = go.getBoundingClientRect();
      t.className = "sb-tip is-title";
      t.innerHTML = `<span class="sb-tip-t">${esc(el.querySelector(".sb-tt")?.textContent ?? "")}</span><span class="sb-tip-x" aria-hidden="true">${TRASH}</span>`;
      t.classList.toggle("is-x", !!el.querySelector(".sb-x:hover"));
      Object.assign(t.style, { left: `${gr.left - rr.left}px`, top: `${gr.top - rr.top}px`, width: `${gr.width}px`, minHeight: "" });
      // never stop across half a line; a group label under it steps aside
      let bottom = gr.top + t.offsetHeight;
      for (const n of list.current?.querySelectorAll(".sb-go, .sb-grp-t") ?? []) {
        const b = n.getBoundingClientRect();
        if (b.top < bottom - 1 && b.bottom > bottom + 1) {
          t.style.minHeight = `${b.bottom - gr.top}px`;
          bottom = b.bottom;
          break;
        }
      }
      list.current?.querySelectorAll(".sb-grp-t").forEach((n) => {
        const b = n.getBoundingClientRect();
        if (b.bottom > gr.bottom && b.top < bottom) n.classList.add("is-under");
      });
    } else {
      const words = tips(kind);
      if (!words) return;
      t.className = "sb-tip";
      t.style.width = "";
      t.style.minHeight = "";
      t.innerHTML = `<span>${esc(words[0])}</span>${words[1] ? `<kbd>${esc(words[1])}</kbd>` : ""}`;
      const card = rail.querySelector(".card")!.getBoundingClientRect();
      if (folded || kind === "fold") {
        const spine = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spine-w")) || 60;
        t.style.left = `${(folded ? card.left + spine : r.right) - rr.left + 10}px`;
        t.style.top = `${r.top - rr.top + r.height / 2 - 16}px`;
      } else {
        t.style.left = `${r.left - rr.left + r.width / 2 - t.offsetWidth / 2}px`;
        t.style.top = `${r.top - rr.top - 40}px`;
      }
    }
    t.classList.remove("is-on");
    void t.offsetWidth;
    t.classList.add("is-on");
    tipWarm.current = true;
    window.clearTimeout(tipCool.current);
  };
  const armTip = (el: HTMLElement, kind: string) => {
    if (phoneNow() || tipFor.current === el) return;
    window.clearTimeout(tipTimer.current);
    if (tipWarm.current) showTip(el, kind);
    else tipTimer.current = window.setTimeout(() => showTip(el, kind), kind === "title" ? 520 : 380);
  };
  return { tipFor, hideTip, showTip, armTip };
}
