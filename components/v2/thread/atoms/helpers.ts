import { toMs } from "../../format";

export type Go = (depth: number, d: -1 | 1) => void;

export const costLabel = (s?: number) => {
  if (!s || s <= 0) return "";
  return `${s < 1 ? s.toFixed(3) : s < 10 ? s.toFixed(1) : Math.round(s).toLocaleString()} sats`;
};

/** 10:31 today, "Mon 10:31" this week, "3 Sep" before that */
export const stamp = (t?: number) => {
  const ms = toMs(t);
  if (!ms) return "";
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const age = Date.now() - ms;
  if (new Date().toDateString() === d.toDateString()) return time;
  if (age < 6 * 86_400_000) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
