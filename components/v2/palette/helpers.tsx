import React from "react";
import type { Conversation } from "@/types/chat";

export const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const phoneNow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
export const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const F_WD = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { weekday: "short" }) : null;
const F_DAY = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }) : null;
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** Chats with what each reply cost, for the panes that sum it. */
export const withCosts = (conversations: Conversation[], costs: Record<string, number>): Conversation[] =>
  conversations.map((c) =>
    c.messages.some((m) => m._eventId && costs[m._eventId] !== undefined)
      ? { ...c, messages: c.messages.map((m) => (m._eventId && costs[m._eventId] !== undefined ? { ...m, satsSpent: costs[m._eventId] } : m)) }
      : c
  );
export const focusComposer = () =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const f = document.querySelector<HTMLTextAreaElement>(".island textarea");
      if (!f) return;
      f.focus({ preventScroll: true });
      f.setSelectionRange(f.value.length, f.value.length);
    })
  );

/** Short, for the row's end: "now", "19 min", "3 h", "Sep 27". */
const ago = (t: number) => {
  const d = Date.now() - t;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h`;
  return F_DAY ? F_DAY.format(t) : "";
};

export const agoLong = (t: number) => {
  const a = ago(t);
  return a === "now" ? "just now" : /min|h$/.test(a) ? `${a} ago` : a;
};

const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Found words marked with one neutral underlay; the text never changes width. */
export function hl(text: string, toks: string[]): React.ReactNode {
  if (!toks.length || !text) return text;
  const re = new RegExp(`(${toks.map(escRe).sort((a, b) => b.length - a.length).join("|")})`, "gi");
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

export const Line = ({ children }: { children: React.ReactNode }) => <p className="pk-pv-k">{children}</p>;
