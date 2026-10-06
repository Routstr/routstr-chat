import { useSyncExternalStore } from "react";

/* Motion tokens read from the room, in milliseconds. The CSS build rewrites
   durations ("320ms" becomes ".32s"), so the unit has to be read too. */
export const tokenMs = (name: string) => {
  if (typeof document === "undefined") return 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
