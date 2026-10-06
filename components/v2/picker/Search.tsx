"use client";

import React from "react";
import { Icon } from "../icons";

export default function Search({
  phone,
  hidden,
  input,
  total,
  activeIdx,
  q,
  setQ,
  setActiveKey,
}: {
  phone: boolean;
  hidden: boolean;
  input: React.RefObject<HTMLInputElement | null>;
  total: number;
  activeIdx: number;
  q: string;
  setQ: (q: string) => void;
  setActiveKey: (k: string | null) => void;
}) {
  return (
    <div className="mp-search" data-sheet-drag={phone ? "" : undefined} inert={hidden}>
      <Icon name="search" size={15} />
      <input
        ref={input}
        type="search"
        placeholder="Search models or makers"
        aria-label="Search models"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded="true"
        aria-controls={total ? "mp-list" : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeIdx >= 0 ? `mp-opt-${activeIdx}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActiveKey(null);
        }}
      />
      <button className="mp-clear" type="button" aria-label="Clear search" tabIndex={q ? 0 : -1} onClick={() => { setQ(""); input.current?.focus(); }}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
