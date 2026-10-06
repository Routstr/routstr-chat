"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import { hostOf } from "../links";
import { lineOf, type Source } from "./cite";

/* Where there is no margin (a narrow panel, a phone), a citation opens a small
   card under its line. Hover or focus shows it; a click, tap or Enter pins it
   and moves focus to "Open source". */
export function CiteCard({
  cite,
  source,
  n,
  pinned,
  onEnter,
  onLeave,
  onClose,
}: {
  cite: HTMLElement;
  source: Source;
  n: string;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: (back?: boolean) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLAnchorElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ox: number; up: boolean; width?: number } | null>(null);
  useLayoutEffect(() => {
    const card = el.current;
    const box = card?.parentElement;
    const thread = cite.closest(".thread");
    if (!card || !box || !thread) return;
    const place = () => {
      const b = box.getBoundingClientRect();
      const r = cite.getBoundingClientRect();
      const line = lineOf(cite);
      const phone = window.innerWidth <= 760;
      const width = phone ? Math.round(b.width) : undefined;
      if (width) card.style.width = `${width}px`;
      const x = phone ? 0 : Math.min(b.width - card.offsetWidth, Math.max(0, r.left - b.left - 18));
      const h = card.offsetHeight;
      const view = thread.getBoundingClientRect();
      const below = line.bottom + 8;
      const up = below + h > view.bottom - 8 && line.top - 8 - h > view.top;
      setPos({ left: Math.round(x), top: Math.round((up ? line.top - 8 - h : below) - b.top), ox: Math.round(r.left - b.left - x + r.width / 2), up, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [cite]);
  useEffect(() => {
    if (pinned) go.current?.focus({ preventScroll: true });
  }, [pinned]);
  const host = source.url ? hostOf(source.url) : "";
  return (
    <div
      ref={el}
      className="rd-card"
      role="dialog"
      aria-label={`Source ${n}`}
      data-pinned={pinned ? "1" : undefined}
      data-up={pos?.up ? "" : undefined}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, width: pos?.width, visibility: pos ? undefined : "hidden", "--ox": `${pos?.ox ?? 20}px` } as React.CSSProperties}
      onPointerEnter={onEnter}
      onPointerLeave={(e) => {
        if (!pinned && !cite.contains(e.relatedTarget as Node)) onLeave();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
        if (e.key === "Tab") {
          e.preventDefault();
          onClose(e.shiftKey);
          if (!e.shiftKey) {
            // carry on from the citation
            const all = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])')).filter(
              (x) => !x.closest(".rd-card, [inert], [hidden]") && x.getClientRects().length
            );
            all[all.indexOf(cite) + 1]?.focus();
          }
        }
      }}
    >
      <span className="rd-card-n">{n}</span>
      <span className="rd-card-h">{host}</span>
      {source.title && source.title !== host && <span className="rd-card-t">{source.title}</span>}
      <a className="rd-card-go" ref={go} href={source.url} target="_blank" rel="noopener noreferrer">
        <Icon name="link" size={14} />
        <span>Open source</span>
      </a>
    </div>
  );
}
