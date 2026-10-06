"use client";

import React, { memo } from "react";
import { renderCompanyIcon } from "@/components/chat/model-selector/display";
import { Icon } from "../icons";
import type { useMakerRail } from "./useMakerRail";
import type { Scope } from "./catalog";

export default function MakerRail({
  hidden,
  railScroll,
  railGlide,
  strip,
  edges,
  stripEdges,
  railKey,
  loading,
  railItems,
  scope,
  pickScope,
}: {
  hidden: boolean;
  railScroll: React.RefObject<HTMLDivElement | null>;
  railGlide: React.RefObject<HTMLDivElement | null>;
  strip: boolean;
  edges: { left: boolean; right: boolean };
  stripEdges: () => void;
  railKey: (e: React.KeyboardEvent) => void;
  loading: boolean;
  railItems: ReturnType<typeof useMakerRail>["railItems"];
  scope: Scope;
  pickScope: (id: Scope, el?: HTMLElement | null) => void;
}) {
  return (
    <nav className="mp-rail" aria-label="Makers" inert={hidden}>
      <div
        className="rail-in scroll"
        ref={railScroll}
        onScroll={stripEdges}
        data-left={strip && edges.left ? "" : undefined}
        data-right={strip && edges.right ? "" : undefined}
      >
        <div className="rail-glide" ref={railGlide} aria-hidden="true" />
        <div className="rail-items" onKeyDown={railKey}>
          {loading ? (
            [58, 72, 64, 0, 70, 60, 74, 56, 66, 62].map((w, i) =>
              w ? <span key={i} className="rail-ghost" style={{ "--i": i, "--w": `${w}%` } as React.CSSProperties} /> : <span key={i} className="rail-cap">&nbsp;</span>
            )
          ) : (
            <>
              {railItems.scopes.map((s) => (
                <RailButton key={s.id} id={s.id} on={scope === s.id} label={s.label} short={s.short} n={s.n} scope glyph={<Icon name={s.icon} size={17} />} onPick={pickScope} />
              ))}
              <p className="rail-cap" aria-hidden="true">Makers</p>
              <span className="rail-sep" aria-hidden="true" />
              {railItems.makers.map((m) => (
                <RailButton key={m.id} id={m.id} on={scope === m.id} label={m.label} n={m.n} glyph={renderCompanyIcon(m.id, "co-ico")} onPick={pickScope} />
              ))}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

const RailButton = memo(function RailButton({
  id,
  on,
  label,
  short,
  n,
  scope,
  glyph,
  onPick,
}: {
  id: string;
  on: boolean;
  label: string;
  short?: string;
  n: number;
  scope?: boolean;
  glyph: React.ReactNode;
  onPick: (id: string, el: HTMLElement) => void;
}) {
  return (
    <button
      className="rail-b"
      type="button"
      data-co={id}
      data-scope={scope ? "" : undefined}
      tabIndex={on ? 0 : -1}
      aria-pressed={on}
      aria-label={`${label}, ${n}`}
      onClick={(e) => onPick(id, e.currentTarget)}
    >
      <span className="rail-g">{glyph}</span>
      <span className="rail-w" aria-hidden="true">
        {short && short !== label ? (
          <>
            <span className="w-long">{label}</span>
            <span className="w-short">{short}</span>
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
});
