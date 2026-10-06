"use client";

import React, { useEffect, useState } from "react";
import { Icon, type IconName } from "../icons";
import type { Filters } from "./helpers";

const TOGGLES: { k: keyof Filters; label: string; short?: string; icon: IconName }[] = [
  { k: "fits", label: "Fits balance", icon: "wallet" },
  { k: "web", label: "Web search", icon: "globe" },
  { k: "priv", label: "Private", icon: "shield" },
  { k: "images", label: "Makes images", short: "Images", icon: "image" },
];

export default function Tools({
  tools,
  f,
  setF,
  inert,
}: {
  tools: React.RefObject<HTMLDivElement | null>;
  f: Filters;
  setF: React.Dispatch<React.SetStateAction<Filters>>;
  inert: boolean;
}) {
  const [end, setEnd] = useState(false);
  const check = () => {
    const t = tools.current;
    if (t) setEnd(t.scrollWidth - t.scrollLeft - t.clientWidth < 4);
  };
  // on scroll and when the strip changes size, never on every render (reading the scroll width
  // lays out the whole card)
  useEffect(() => {
    const t = tools.current;
    if (!t) return;
    const ro = new ResizeObserver(() => check());
    ro.observe(t);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="mp-tools" role="group" aria-label="Filters" ref={tools} onScroll={check} data-end={end ? "" : undefined} inert={inert}>
      {TOGGLES.map((t) => (
        <button key={t.k} className="tog" type="button" aria-pressed={f[t.k]} aria-label={t.label} onClick={() => setF((x) => ({ ...x, [t.k]: !x[t.k] }))}>
          <Icon name={t.icon} size={15} />
          {t.short ? (
            <>
              <span className="t-long">{t.label}</span>
              <span className="t-short">{t.short}</span>
            </>
          ) : (
            <span>{t.label}</span>
          )}
        </button>
      ))}
    </div>
  );
}
