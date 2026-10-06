"use client";

import { useState, useEffect } from "react";
import { Icon } from "../../icons";
import { CopyTool } from "../atoms/CopyTool";
import { Vers } from "../atoms/Vers";
import { useReducedMotion } from "../../motion";
import { costLabel } from "../atoms/helpers";

export function Strip({
  text,
  versions,
  cost,
  roll,
  model,
  canRetry,
  onRetry,
  stopped,
}: {
  text: string;
  versions?: { at: number; of: number; go: (d: -1 | 1) => void };
  cost?: string;
  roll?: number;
  model: string;
  canRetry: boolean;
  onRetry: () => void;
  stopped?: boolean;
}) {
  const [turning, setTurning] = useState(false);
  return (
    <div className="rd-strip">
      {versions && versions.of > 1 && <Vers {...versions} />}
      <div className="rd-tools">
        <CopyTool text={text} />
        <button
          type="button"
          className={`rd-tool${turning ? " is-turning" : ""}`}
          onClick={(e) => {
            const keys = e.currentTarget.matches(":focus-visible");
            setTurning(true);
            window.setTimeout(() => setTurning(false), 440);
            onRetry();
            if (keys) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus({ preventScroll: true }));
          }}
          disabled={!canRetry}
          aria-label="Try again"
          data-tip="Try again"
        >
          <Icon name="retry" />
        </button>
      </div>
      <p className="rd-sum">
        <span className="rd-model">{model}</span>
        <span className="rd-cost">
          {stopped && (
            <>
              stopped
              {(roll || cost) && <span className="stop-dot"> · </span>}
            </>
          )}
          {roll ? <RollingCost value={roll} /> : cost}
        </span>
      </p>
    </div>
  );
}

/** A just-finished reply's cost counts up once, instead of appearing. */
function RollingCost({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 520);
      setV(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);
  return <>{costLabel(Math.max(reduce ? value : v, 0.001))}</>;
}
