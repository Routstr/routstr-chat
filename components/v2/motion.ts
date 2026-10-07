import { useSyncExternalStore } from "react";

/* Motion tokens read from the room, in milliseconds. The CSS build rewrites
   durations ("320ms" becomes ".32s"), so the unit has to be read too. */
/** A token of the root, read from the page once: reading the computed style
 *  in the middle of a commit makes the browser work out every style first. */
const tokens = new Map<string, string>();
export const rootToken = (name: string) => {
  if (typeof document === "undefined") return "";
  let v = tokens.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    // the stylesheet may not be in yet: an empty value is read again next time
    if (v) tokens.set(name, v);
  }
  return v;
};

export const tokenMs = (name: string) => {
  const v = rootToken(name);
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : n;
};

const REDUCE = "(prefers-reduced-motion: reduce)";
const onReduce = (on: () => void) => {
  const m = window.matchMedia(REDUCE);
  m.addEventListener("change", on);
  return () => m.removeEventListener("change", on);
};

/** The system's reduced motion, for what a render draws (off on the server). */
export const useReducedMotion = () =>
  useSyncExternalStore(
    onReduce,
    () => window.matchMedia(REDUCE).matches,
    () => false
  );
