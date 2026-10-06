"use client";

import React from "react";
import { Icon } from "../icons";
import type { Item } from "./types";

export default function Field({
  page,
  q,
  phone,
  input,
  it,
  at,
  back,
  setQuery,
  onKey,
  close,
}: {
  page: "root" | "rooms";
  q: string;
  phone: boolean;
  input: React.RefObject<HTMLInputElement | null>;
  it: Item | undefined;
  at: number;
  back: () => void;
  setQuery: (v: string) => void;
  onKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  close: () => void;
}) {
  return (
    <div className="pk-field" data-q={q.trim() ? "" : undefined}>
      {page === "rooms" ? (
        <button
          type="button"
          className="pk-crumb"
          aria-label="Back to everything"
          tabIndex={-1}
          onClick={() => {
            back();
            input.current?.focus();
          }}
        >
          <Icon name={phone ? "left" : "back"} size={16} />
          <span>Rooms</span>
        </button>
      ) : (
        <Icon name="search" />
      )}
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="pk-list"
        aria-autocomplete="list"
        aria-activedescendant={it ? `pk-o-${at}` : undefined}
        aria-label={page === "rooms" ? "Filter rooms" : "Search chats and actions"}
        autoComplete="off"
        spellCheck={false}
        placeholder={page === "rooms" ? "Filter rooms" : "Find a chat or an action"}
        value={q}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
      />
      <button
        type="button"
        className="pk-clear"
        aria-label="Clear search"
        tabIndex={-1}
        onClick={() => {
          setQuery("");
          input.current?.focus();
        }}
      >
        <Icon name="close" size={15} />
      </button>
      <button type="button" className="pk-cancel" onClick={() => close()}>
        Cancel
      </button>
    </div>
  );
}
