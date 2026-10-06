"use client";

import React from "react";
import { Icon, type IconName } from "../../icons";

export const PRESETS = [500, 1000, 5000];
export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
export const nbsp = (s: string) => s.replace(/ ([^ ]+)$/, " $1"); // no lonely last word

export const phoneNow = () => typeof window !== "undefined" && window.innerWidth <= 760;
export const touch = () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
export const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Warn() {
  return (
    <svg className="v2-ico pa-wi" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.6M12 15.8v.01" />
    </svg>
  );
}

export function Seal() {
  return (
    <span className="pa-seal" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="m5.5 12.6 4 4 9-9.2" pathLength={30} />
      </svg>
    </span>
  );
}

/** A button whose label can swap (Copy / Copied, Connect / Connecting)
 *  without ever changing width: both labels share one grid cell. */
export function Swap({
  className,
  icon,
  idle,
  busy,
  on,
  onClick,
  disabled,
  mode = "busy",
}: {
  className: string;
  icon: IconName;
  idle: string;
  busy: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  mode?: "busy" | "copied";
}) {
  return (
    <button
      className={`${className} pa-swapb`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={on ? busy : idle}
      aria-busy={mode === "busy" ? on : undefined}
      data-on={on ? "" : undefined}
    >
      <span className="pa-swapc">
        <span className="pa-swap">
          <Icon name={icon} size={16} />
          {mode === "busy" ? <span className="spin-s" aria-hidden="true" /> : <Icon name="check" size={16} />}
        </span>
        <span className="pa-swapw" aria-hidden="true">
          <span>{idle}</span>
          <span>{busy}</span>
        </span>
      </span>
    </button>
  );
}

export const pasteInto = async (set: (v: string) => void, focusSel: string) => {
  try {
    set((await navigator.clipboard.readText()).trim());
  } catch {
    document.querySelector<HTMLElement>(focusSel)?.focus();
  }
};
