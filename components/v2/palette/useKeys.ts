import React, { useLayoutEffect, useRef } from "react";
import type { RoomId, useRoom } from "../room/RoomProvider";
import { MAC } from "./helpers";
import { roomsFor } from "./rank";
import type { Exit, Item, Sel } from "./types";

export function useSelection({
  flat,
  at,
  q,
  page,
  setActive,
  instant,
  instantTwice,
}: {
  flat: Item[];
  at: number;
  q: string;
  page: "root" | "rooms";
  setActive: (i: number) => void;
  instant: React.RefObject<boolean>;
  instantTwice: React.RefObject<boolean>;
}) {
  // the selection is an item, not a row number: when the list changes under it (a chat
  // arrives, a sync finishes) it stays on the same item. A new query starts at the top.
  // (at: where it stood, so a move in the same pass as a rebuild is taken as the move it is)
  const sel = useRef<Sel>({ at, q, page, list: flat });
  useLayoutEffect(() => {
    const was = sel.current;
    const rebuilt = was.list !== flat;
    if (rebuilt && was.at === at && was.q === q && was.page === page && was.id && flat[at]?.id !== was.id) {
      const i = flat.findIndex((x) => x.id === was.id);
      if (i > -1) {
        // its row moved without animating: the glide lands with it (the first pass already used one)
        instant.current = true;
        instantTwice.current = true;
        setActive(i);
        return;
      }
    }
    sel.current = { id: flat[at]?.id, at, q, page, list: flat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, at]);
  return sel;
}

export function useKeys({
  page,
  q,
  it,
  at,
  flat,
  active,
  phone,
  setActive,
  setPage,
  setQ,
  setEnter,
  setKeysUsed,
  origRoom,
  quiet,
  instant,
  scrollNext,
  list,
  room,
  cancelPreview,
  close,
  run,
  homeRow,
}: {
  page: "root" | "rooms";
  q: string;
  it: Item | undefined;
  at: number;
  flat: Item[];
  active: number;
  phone: boolean;
  setActive: (i: number) => void;
  setPage: (p: "root" | "rooms") => void;
  setQ: (q: string) => void;
  setEnter: (e: "fwd" | "back" | null) => void;
  setKeysUsed: (v: boolean) => void;
  origRoom: React.RefObject<RoomId | null>;
  quiet: React.RefObject<boolean>;
  instant: React.RefObject<boolean>;
  scrollNext: React.RefObject<boolean>;
  list: React.RefObject<HTMLDivElement | null>;
  room: ReturnType<typeof useRoom>;
  cancelPreview: () => void;
  close: (how?: Exit) => void;
  run: (x: Item | undefined) => void;
  homeRow: (l: Item[]) => number;
}) {
  const lastRoom = useRef<string | null>(null);
  const back = () => {
    cancelPreview();
    if (origRoom.current) room.setRoom(origRoom.current);
    origRoom.current = null;
    setPage("root");
    setQ("");
    setEnter("back");
    instant.current = true;
    // back onto the row that opened the page
    setActive(-1);
  };
  // after going back, find "Change room" in the rebuilt list
  useLayoutEffect(() => {
    if (active !== -1) return;
    setActive(Math.max(0, flat.findIndex((x) => x.id === "room")));
    scrollNext.current = true;
  }, [active, flat]);
  useLayoutEffect(() => {
    if (active === -2) setActive(homeRow(flat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, flat]);

  const setQuery = (v: string) => {
    if (page !== "rooms") {
      // typing rebuilds the list at once: the selection is placed, not slid over unrelated rows
      instant.current = true;
      setQ(v);
      // cleared, it starts where a fresh open starts (found once the list is rebuilt)
      setActive(v.trim() ? 0 : -2);
      if (list.current) list.current.scrollTop = 0;
      return;
    }
    // rooms: the selection stays on its room while that room is listed; a filter that matched
    // nothing hands it back to the last room you were on (or the one you came from), never room 1
    if (it?.room) lastRoom.current = it.id;
    const keep = lastRoom.current ?? `room-${origRoom.current}`;
    const next = roomsFor(v);
    let i = next.findIndex((r) => `room-${r.id}` === keep);
    if (i < 0) i = Math.max(0, next.findIndex((r) => r.id !== "auto"));
    quiet.current = true;
    setQ(v);
    setActive(i);
    scrollNext.current = true;
    requestAnimationFrame(() => (quiet.current = false));
  };
  const escape = () => {
    if (q.trim()) return setQuery("");
    if (page !== "root") return back();
    close();
  };
  const move = (d: number) => {
    setKeysUsed(true);
    if (!flat.length) return;
    setActive(Math.max(0, Math.min(flat.length - 1, at + d)));
    scrollNext.current = true;
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (e.nativeEvent.isComposing) return;
    // the New chat row's own shortcut does what its Enter does, here too
    if ((MAC ? e.metaKey : e.ctrlKey) && e.shiftKey && k.toLowerCase() === "o") {
      e.preventDefault();
      e.stopPropagation();
      return run({ kind: "action", id: "new", act: "new", verb: "Start", ic: null, label: "New chat" });
    }
    // a row's shortcut does what its Enter does, here too (the sidebar would fold behind the veil)
    if (!phone && (MAC ? e.metaKey : e.ctrlKey) && !e.shiftKey && k.toLowerCase() === "b") {
      e.preventDefault();
      e.stopPropagation();
      return run({ kind: "action", id: "rail", act: "rail", verb: "Collapse", ic: null, label: "Sidebar" });
    }
    // on a Mac, Ctrl+N / Ctrl+P step one row (elsewhere the browser keeps Ctrl+N); ⌘ (Ctrl off a
    // Mac) with an arrow jumps to an end
    if (MAC && e.ctrlKey && !e.shiftKey && (k === "n" || k === "p")) {
      e.preventDefault();
      move(k === "n" ? 1 : -1);
    } else if (k === "ArrowDown") {
      e.preventDefault();
      move((MAC ? e.metaKey : e.ctrlKey) ? 1e3 : 1);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      move((MAC ? e.metaKey : e.ctrlKey) ? -1e3 : -1);
    } else if (k === "PageDown") {
      e.preventDefault();
      move(6);
    } else if (k === "PageUp") {
      e.preventDefault();
      move(-6);
    } else if (k === "Enter") {
      e.preventDefault();
      run(it);
    } else if (k === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      escape();
    } else if (k === "Backspace" && !e.repeat && !e.currentTarget.value && page !== "root") {
      e.preventDefault();
      back();
    } else if (k === "Tab") {
      e.preventDefault();
    }
  };
  return { back, setQuery, escape, onKey };
}
