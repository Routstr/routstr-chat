"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "../../motion";

/** A digit that rolls to its new value: up when it grows, down when it shrinks. */
export function Roll({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState({ now: value, was: null as number | null, up: true });
  if (value !== shown.now) setShown(reduce ? { now: value, was: null, up: true } : { now: value, was: shown.now, up: value > shown.now });
  useEffect(() => {
    if (shown.was === null) return;
    const t = window.setTimeout(() => setShown((s) => ({ ...s, was: null })), 220);
    return () => window.clearTimeout(t);
  }, [shown]);
  const dir = shown.up ? "up" : "down";
  return (
    <span className="rd-roll">
      {shown.was !== null && (
        <span key={`o${shown.was}`} className={`rd-roll-out-${dir}`}>
          {shown.was}
        </span>
      )}
      <span key={`n${shown.now}`} className={shown.was !== null ? `rd-roll-in-${dir}` : undefined}>
        {shown.now}
      </span>
    </span>
  );
}
