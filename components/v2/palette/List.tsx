"use client";

import React, { memo } from "react";
import type { Group, Item, Sel } from "./types";

/* one row; only the rows whose selection changes render again */
const Row = memo(function Row({ it, i, sel, fresh }: { it: Item; i: number; sel: boolean; fresh: boolean }) {
  return (
    <div className={`pk-row${fresh ? " pk-fresh" : ""}`} role="option" id={`pk-o-${i}`} data-i={i} data-kind={it.kind} aria-selected={sel}>
      <span className="pk-ic">{it.ic}</span>
      <span className="pk-main">
        <span className="pk-l">{it.label}</span>
        {it.sub && <span className="pk-s">{it.sub}</span>}
      </span>
      <span className="pk-h">{it.hint}</span>
    </div>
  );
});

export default function List({
  list,
  glide,
  pageEl,
  enter,
  setEnter,
  page,
  groups,
  at,
  came,
  q,
  flat,
  sel: selRef,
  setActive,
  run,
}: {
  list: React.RefObject<HTMLDivElement | null>;
  glide: React.RefObject<HTMLDivElement | null>;
  pageEl: React.RefObject<HTMLDivElement | null>;
  enter: "fwd" | "back" | null;
  setEnter: (e: "fwd" | "back" | null) => void;
  page: "root" | "rooms";
  groups: Group[];
  at: number;
  came: string[];
  q: string;
  flat: Item[];
  sel: React.RefObject<Sel>;
  setActive: (i: number) => void;
  run: (x: Item | undefined) => void;
}) {
  let n = -1;
  return (
    <div
      className="pk-list scroll"
      id="pk-list"
      role="listbox"
      aria-label="Results"
      ref={list}
      onPointerMove={(e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>(".pk-row");
        if (!row) return;
        const i = Number(row.dataset.i);
        if (i !== at) setActive(i);
      }}
      // a click never takes the keys from the field: Esc, the arrows and Enter keep working
      onClick={(e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>(".pk-row");
        if (!row) return;
        const i = Number(row.dataset.i);
        setActive(i);
        // chosen on purpose: a list rebuilt by what it runs (Sync) must not pull it back
        selRef.current = { ...selRef.current, id: flat[i].id };
        run(flat[i]);
      }}
    >
      <div className="pk-list-in">
        <div className="pk-glide" ref={glide} data-instant="" data-enter={enter ?? undefined} aria-hidden="true" />
        <div className="pk-page" ref={pageEl} data-enter={enter ?? undefined} key={page} onAnimationEnd={() => setEnter(null)}>
          {groups.map((g, gi) => {
            const gid = g.title ? `pk-g-${gi}` : undefined;
            const head = g.title ? (
              <h3 className="pk-gt" id={gid}>
                {g.title}
              </h3>
            ) : null;
            if (g.ghost)
              return (
                <div className="pk-grp pf-ghost" role="status" aria-label="Finding your chats" key={gi}>
                  {head}
                  {Array.from({ length: g.ghost }, (_, r) => (
                    <div className="pk-ghostrow" key={r}>
                      <span className="pf-gw" />
                      <span>
                        {[3.2, 5.6, 2.4, 4.4].slice(0, 2 + (r % 3)).map((w, k) => (
                          <span className="pf-gw" key={k} style={{ width: `${w + ((r * 7 + k * 3) % 5) * 0.4}em` }} />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              );
            if (g.note)
              return (
                <div className="pk-grp" key={gi}>
                  {head}
                  <p className="pk-note">{g.note}</p>
                </div>
              );
            return (
              <div className="pk-grp" role="group" aria-labelledby={gid} key={gi}>
                {g.fallback && (
                  <p className="pk-note">
                    Nothing matches <q>{q.trim()}</q> in your chats or actions.
                  </p>
                )}
                {head}
                {g.items.map((x) => {
                  n++;
                  return <Row key={x.id} it={x} i={n} sel={n === at} fresh={!!x.chat && came.includes(x.chat.id)} />;
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
