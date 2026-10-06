import React, { useEffect, useLayoutEffect, useRef } from "react";
import type { useUi } from "../ui";
import type { RoomId, useRoom } from "../room/RoomProvider";
import { focusComposer } from "./helpers";
import type { Exit, Item } from "./types";

export function useOpenClose({
  closing,
  pk,
  veil,
  input,
  flat,
  homeRow,
  setActive,
  instantTwice,
  cancelPreview,
  origRoom,
  room,
  ui,
}: {
  closing: boolean;
  pk: React.RefObject<HTMLDivElement | null>;
  veil: React.RefObject<HTMLDivElement | null>;
  input: React.RefObject<HTMLInputElement | null>;
  flat: Item[];
  homeRow: (l: Item[]) => number;
  setActive: (i: number) => void;
  instantTwice: React.RefObject<boolean>;
  cancelPreview: () => void;
  origRoom: React.RefObject<RoomId | null>;
  room: ReturnType<typeof useRoom>;
  ui: ReturnType<typeof useUi>;
}) {
  const returnTo = useRef<Element | null>(null);
  // how the palette closes: which room stays, and where the focus goes
  const exit = useRef<Exit>({});

  /* ── opening ─────────────────────────────────────────────────────────── */
  useLayoutEffect(() => {
    // (StrictMode runs this twice in development: never record the palette's own field)
    const a = document.activeElement;
    if (!pk.current?.contains(a)) returnTo.current = a;
    // over a chat, the previous chat is the one you most likely want; placed there, not slid
    if (homeRow(flat)) {
      setActive(1);
      // the first placement (row 0, this render) must not use up the instant one
      instantTwice.current = true;
    }
    const el = pk.current;
    const v = veil.current;
    if (!el || !v) return;
    void el.offsetWidth; // commit the closed pose, then open (a reflow, not a frame)
    el.dataset.on = "";
    v.dataset.on = "";
    input.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── closing: put back the room you came from, and the focus ───────────── */
  useEffect(() => {
    if (!closing) return;
    delete pk.current?.dataset.on;
    const how = exit.current;
    if (!how.keepRoom) {
      cancelPreview();
      if (origRoom.current) room.setRoom(origRoom.current);
    }
    if (how.composer) focusComposer();
    // another surface opened in its place and holds the focus now
    else if (how.handoff) return;
    else if (returnTo.current instanceof HTMLElement && returnTo.current.isConnected) returnTo.current.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);
  const close = (how: Exit = {}) => {
    exit.current = how;
    ui.setPalette(false);
  };
  return close;
}
