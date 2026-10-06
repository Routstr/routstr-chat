"use client";

import { useEffect, useState } from "react";
import { reduced } from "./helpers";

/** A digit that rolls to its new value: up when it grows, down when it shrinks. */
export function Roll({ value }: { value: number }) {
  const [shown, setShown] = useState({ now: value, was: null as number | null, up: true });
  useEffect(() => {
    if (value === shown.now) return;
    if (reduced()) return setShown({ now: value, was: null, up: true });
    setShown((s) => ({ now: value, was: s.now, up: value > s.now }));
    const t = window.setTimeout(() => setShown((s) => ({ ...s, was: null })), 220);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
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
