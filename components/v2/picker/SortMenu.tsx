"use client";

import React from "react";
import { Icon } from "../icons";
import type { Catalog } from "./useCatalog";
import { SORTS, sortLabel, type SortKey } from "./catalog";

export default function SortMenu({
  menu,
  setMenu,
  sortBtn,
  menuEl,
  menuH,
  menuMore,
  setMenuMore,
  menuKey,
  pickSort,
  sort,
  dir,
  cat,
  only,
  setOnly,
}: {
  menu: boolean;
  setMenu: React.Dispatch<React.SetStateAction<boolean>>;
  sortBtn: React.RefObject<HTMLButtonElement | null>;
  menuEl: React.RefObject<HTMLDivElement | null>;
  menuH: number;
  menuMore: boolean;
  setMenuMore: (m: boolean) => void;
  menuKey: (e: React.KeyboardEvent) => void;
  pickSort: (k: SortKey) => void;
  sort: SortKey;
  dir: 1 | -1;
  cat: Catalog;
  only: string | null;
  setOnly: (o: string | null) => void;
}) {
  return (
    <div
      className="mp-sortwrap"
      onBlur={(e) => {
        // Tab away closes the menu, so it never hangs over the list
        if (menu && !e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(false);
      }}
    >
      <button ref={sortBtn} className="mp-sort" type="button" aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" || menu) return;
          e.preventDefault();
          setMenu(true);
        }}
      >
        <span className="mp-sort-l" key={`${sort}${dir}`}>{sortLabel(sort, dir)}</span>
        <Icon name="down" size={13} />
      </button>
      <div
        className="mp-menu"
        ref={menuEl}
        role="menu"
        aria-label="Sort and source"
        style={{ "--menu-h": `${menuH}px` } as React.CSSProperties}
        data-more={menuMore ? "" : undefined}
        onScroll={(e) => {
          const m = e.currentTarget;
          setMenuMore(m.scrollHeight - m.scrollTop - m.clientHeight > 6);
        }}
        onKeyDown={menuKey}
      >
        <p className="menu-t">Sort by</p>
        {SORTS.map((s) => {
          const on = sort === s.key;
          const next = sortLabel(s.key, on ? ((-dir) as 1 | -1) : 1).toLowerCase();
          return (
            <button
              key={s.key}
              className="mi"
              role="menuitemradio"
              type="button"
              aria-checked={on}
              tabIndex={-1}
              title={on ? `Press again for ${next}` : undefined}
              aria-label={on ? `${sortLabel(s.key, dir)}. Press again for ${next}` : undefined}
              onClick={() => pickSort(s.key)}
            >
              <span>{on ? sortLabel(s.key, dir) : s.first}</span>
              <Icon name="check" size={15} className="mi-c" />
            </button>
          );
        })}
        {cat.hosts.length > 1 && (
          <>
            <p className="menu-t">Only from</p>
            <button className="mi" role="menuitemradio" type="button" tabIndex={-1} aria-checked={!only} onClick={() => { setOnly(null); setMenu(false); sortBtn.current?.focus(); }}>
              <span>Any provider</span>
              <Icon name="check" size={15} className="mi-c" />
            </button>
            {cat.hosts.map((h) => (
              <button key={h.base} className="mi mono-i" role="menuitemradio" type="button" tabIndex={-1} aria-checked={only === h.base} onClick={() => { setOnly(h.base); setMenu(false); sortBtn.current?.focus(); }}>
                <span>{h.host}</span>
                <Icon name="check" size={15} className="mi-c" />
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
