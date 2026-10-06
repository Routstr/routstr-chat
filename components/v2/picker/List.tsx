"use client";

import React from "react";
import { shortModelName } from "../format";
import type { Catalog } from "./useCatalog";
import type { Filters } from "./helpers";
import type { Section } from "./useSections";
import type { Row, Scope } from "./catalog";
import type { useFacts } from "./useFacts";
import ModelRow from "./ModelRow";
import Empty from "./Empty";

export default function List({
  listEl,
  glide,
  hidden,
  total,
  loading,
  sections,
  cap,
  facts,
  isFavRow,
  isCurrent,
  activeIdx,
  phone,
  q,
  scope,
  f,
  only,
  cat,
  clearAll,
  fund,
  allOn,
  onListMove,
  onListClick,
}: {
  listEl: React.RefObject<HTMLDivElement | null>;
  glide: React.RefObject<HTMLDivElement | null>;
  hidden: boolean;
  total: number;
  loading: boolean;
  sections: Section[];
  cap: number;
  facts: ReturnType<typeof useFacts>;
  isFavRow: (r: Row) => boolean;
  isCurrent: (r: Row) => boolean;
  activeIdx: number;
  phone: boolean;
  q: string;
  scope: Scope;
  f: Filters;
  only: string | null;
  cat: Catalog;
  clearAll: () => void;
  fund: () => void;
  allOn: () => void;
  onListMove: (e: React.PointerEvent) => void;
  onListClick: (e: React.MouseEvent) => void;
}) {
  let n = -1;
  return (
    <div
        onPointerDown={(e) => {
          if (e.pointerType !== "touch" && (e.target as Element).closest(".r-star, .r-more")) e.preventDefault();
        }}
        className="mp-list scroll" id="mp-list" role={total ? "listbox" : undefined} aria-label={total ? "Models" : undefined} tabIndex={-1} ref={listEl} onScroll={(e) => e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 0)} onPointerMove={onListMove} onClick={onListClick} inert={hidden}>
      <div className="glide" ref={glide} aria-hidden="true" />
      <div className="list-in">
        {loading ? (
          <div className="ghost-rows" aria-busy="true" aria-label="Loading models">
            {[62, 48, 70, 54, 44, 66, 52].map((w, i) => (
              <div key={i} className="gr" style={{ "--w": `${w}%`, "--i": i } as React.CSSProperties}><i /><b /><s /></div>
            ))}
          </div>
        ) : !total ? (
          <Empty scope={scope} q={q} f={f} only={only} balance={cat.balance} onClear={clearAll} onFund={fund} onUseAll={allOn} />
        ) : (
          sections.map((s) => (
            <div key={s.title} className="sec" role="group" aria-label={s.title}>
              {sections.length > 1 && <h3 className="sec-t">{s.title}</h3>}
              {s.rows.map((r) => {
                n++;
                if (n >= cap) return null;
                const fx = facts.get(r.key)!;
                return (
                  <ModelRow
                    key={`${s.title}-${r.key}`}
                    i={n}
                    row={r}
                    name={shortModelName(r.model.name, r.model.id)}
                    q={q}
                    price={fx.price}
                    sub={fx.sub}
                    short={fx.short}
                    fav={isFavRow(r)}
                    current={isCurrent(r)}
                    active={n === activeIdx}
                    touch={phone}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
