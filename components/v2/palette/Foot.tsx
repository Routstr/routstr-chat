"use client";

import React from "react";
import type { Conversation } from "@/types/chat";
import { Icon } from "../icons";
import { ROOMS, type RoomId } from "../room/RoomProvider";
import { plural } from "./helpers";
import type { Item, Sync } from "./types";

/* ── the footer: where you are, and what the keys will do ────────────── */
export default function Foot({
  it,
  flat,
  sync,
  page,
  q,
  origRoom,
  conversationsLoaded,
  conversations,
  run,
  escape,
  input,
}: {
  it: Item | undefined;
  flat: Item[];
  sync: Sync;
  page: "root" | "rooms";
  q: string;
  origRoom: React.RefObject<RoomId | null>;
  conversationsLoaded: boolean;
  conversations: Conversation[];
  run: (x: Item | undefined) => void;
  escape: () => void;
  input: React.RefObject<HTMLInputElement | null>;
}) {
  const chatsFound = flat.filter((x) => x.kind === "chat").length;
  // only the sync asked for here: a background one has its own line in the rail
  const syncBusy = sync === "running";
  const footL =
    syncBusy && it?.id !== "sync" ? (
      <>
        <span className="pk-spin">
          <Icon name="sync" size={13} />
        </span>
        Syncing chats
      </>
    ) : !conversationsLoaded ? (
      "Finding your chats"
    ) : page === "rooms" ? (
      `You came from ${ROOMS.find((r) => r.id === origRoom.current)?.name ?? "this room"}`
    ) : q.trim() ? (
      // what the search found, not only its chats (a good action match never reads as a failure)
      chatsFound ? `${plural(chatsFound, "chat")} found` : flat.some((x) => x.kind !== "fallback") ? plural(flat.filter((x) => x.kind !== "fallback").length, "result") : "No chats match"
    ) : conversations.length ? (
      `${plural(conversations.length, "chat")} on this device`
    ) : (
      "No chats on this device yet"
    );
  const escWord = q.trim() ? "Clear" : page !== "root" ? "Back" : "Close";
  return (
    <div className="pk-foot">
      <span className="pk-foot-l">{footL}</span>
      <span className="pk-foot-r">
        {it &&
          (it.id === "sync" && sync === "running" ? (
            <span className="pk-act is-busy" aria-disabled="true">
              Syncing
            </span>
          ) : (
            <button type="button" className="pk-act primary" tabIndex={-1} onClick={() => (run(it), input.current?.focus())}>
              {it.verb}
              <kbd>↵</kbd>
            </button>
          ))}
        {it && <i />}
        <button type="button" className="pk-act" tabIndex={-1} onClick={() => (escape(), input.current?.focus())}>
          {escWord}
          <kbd>esc</kbd>
        </button>
      </span>
    </div>
  );
}
