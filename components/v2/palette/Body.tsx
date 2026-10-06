"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useReplyCosts } from "@/features/chat/view";
import { useConversations, useHistoryLoaded } from "@/features/history/view";
import type { Conversation } from "@/types/chat";
import type { Model } from "@/types/models";
import { useDraft, useUi } from "../ui";
import { useChatModel } from "../useChatModel";
import { useRoom, type RoomId } from "../room/RoomProvider";
import { useMoney } from "../useMoney";
import { phoneNow, withCosts } from "./helpers";
import { tokens } from "./rank";
import { runItem } from "./run";
import { useModels } from "./useModels";
import { useGroups } from "./useGroups";
import { useKeys, useSelection } from "./useKeys";
import { useOpenClose } from "./useOpenClose";
import { grabDown, usePlace } from "./usePlace";
import { useGhostDelays, useGlide, useShowArrival } from "./useGlide";
import { useRoomPreview } from "./useRoomPreview";
import { useSync } from "./useSync";
import Field from "./Field";
import List from "./List";
import Preview from "./Preview";
import Foot from "./Foot";
import type { Item, Sync } from "./types";

/* ══ the palette ═══════════════════════════════════════════════════════ */
export default function Body({ closing }: { closing: boolean }) {
  const ui = useUi();
  const room = useRoom();
  const money = useMoney();
  const { activeConversationId, loadConversation, startNewConversation } = useChat();
  const { setText: setInputMessage } = useDraft();
  const { models, model: selectedModel } = useChatModel();
  const replyCosts = useReplyCosts();
  const { isSidebarCollapsed } = ui;
  const stored = useConversations();
  const conversations = useMemo(() => withCosts(stored, replyCosts), [stored, replyCosts]);
  const conversationsLoaded = useHistoryLoaded();
  const [phone, setPhone] = useState(phoneNow);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 760px)");
    const on = () => setPhone(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const [page, setPage] = useState<"root" | "rooms">("root");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [enter, setEnter] = useState<"fwd" | "back" | null>(null);
  const [keysUsed, setKeysUsed] = useState(false);
  const [sync, setSync] = useState<Sync>("idle");
  const [came, setCame] = useState<string[]>([]);
  const origRoom = useRef<RoomId | null>(null);
  const quiet = useRef(false);

  const pk = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const glide = useRef<HTMLDivElement>(null);
  const pageEl = useRef<HTMLDivElement>(null);
  const instant = useRef(true);
  const instantTwice = useRef(false);
  const scrollNext = useRef(false);
  const roomTimer = useRef(0);
  const roomSeq = useRef(0);
  const cancelPreview = () => {
    window.clearTimeout(roomTimer.current);
    roomSeq.current++;
  };

  const { byId, glyph, perReply, modelWords } = useModels(models);
  const current = (c: Conversation) => c.id === activeConversationId && c.messages.length > 0;
  // the page behind is already a new chat: New chat has nothing to open, it stays
  const onEmpty = !conversations.find((c) => c.id === activeConversationId)?.messages.length;
  // the row an empty root list starts on: over a chat, the previous one
  const homeRow = (l: Item[]) => (!phoneNow() && l[0]?.chat && current(l[0].chat) && l[1]?.kind === "chat" ? 1 : 0);
  const first = conversationsLoaded && conversations.length === 0;

  const groups = useGroups({ q, page, conversations, conversationsLoaded, activeConversationId, glyph, modelWords, isSidebarCollapsed, sync, came, phone, room, origRoom, current, onEmpty });
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const at = Math.min(active, Math.max(0, flat.length - 1));
  const it = flat[at];
  const sel = useSelection({ flat, at, q, page, setActive, instant, instantTwice });
  const close = useOpenClose({ closing, pk, veil, input, flat, homeRow, setActive, instantTwice, cancelPreview, origRoom, room, ui });
  usePlace(pk, list, phone);
  useGlide({ list, glide, at, groups, instant, instantTwice, scrollNext });
  useShowArrival(list, came, page, q);
  useRoomPreview({ page, it, quiet, room, roomTimer, roomSeq });
  const runSync = useSync({ it, conversations, sync, setSync, setCame });
  const run = (x: Item | undefined) =>
    runItem(x, { q, onEmpty, current, ui, room, origRoom, instant, setPage, setQ, setEnter, setActive, runSync, cancelPreview, close, loadConversation, startNewConversation, setInputMessage });
  const { back, setQuery, escape, onKey } = useKeys({
    page, q, it, at, flat, active, phone, setActive, setPage, setQ, setEnter, setKeysUsed, origRoom, quiet, instant, scrollNext, list, room, cancelPreview, close, run, homeRow,
  });
  useGhostDelays(pageEl, groups);

  const toks = useMemo(() => tokens(q), [q]);
  const shown = useDeferredValue(it);

  return (
    <>
      <div className="pk-veil" ref={veil} data-closing={closing ? "" : undefined} onClick={() => close()} />
      <div
        className="pk"
        ref={pk}
        // a click anywhere in the frame never takes the keys from the field (the buttons that need
        // the focus put it back themselves)
        onMouseDown={(e) => e.target !== input.current && e.preventDefault()}
        role="dialog"
        aria-modal="true"
        aria-label="Search and go"
        data-page={page}
        // on touch nothing is lit until the arrow keys are used: a tap is the choice
        data-touch={phone && !keysUsed ? "" : undefined}
        data-closing={closing ? "" : undefined}
      >
        {phone && (
          // the phone sheet's handle: drag it down to put the sheet away, as the model sheet does
          <button type="button" className="pk-grab" aria-label="Close search" tabIndex={-1} onPointerDown={(e) => grabDown(e, pk, close)} onClick={() => close()}>
            <i />
          </button>
        )}
        <Field page={page} q={q} phone={phone} input={input} it={it} at={at} back={back} setQuery={setQuery} onKey={onKey} close={close} />
        <div className="pk-body">
          <List list={list} glide={glide} pageEl={pageEl} enter={enter} setEnter={setEnter} page={page} groups={groups} at={at} came={came} q={q} flat={flat} sel={sel} setActive={setActive} run={run} />
          {!phone && (
            <div className="pk-pv">
              <Preview
                it={shown}
                toks={toks}
                q={q}
                ctx={{
                  page,
                  sync,
                  came,
                  origRoom,
                  roomNow: room.room,
                  roomResolved: room.resolved,
                  first,
                  onEmpty,
                  loaded: conversationsLoaded,
                  conversations,
                  current,
                  glyph,
                  perReply,
                  byId,
                  selectedModel,
                  total: money.total,
                  railOff: isSidebarCollapsed,
                }}
              />
            </div>
          )}
        </div>
        {!phone && <Foot it={it} flat={flat} sync={sync} page={page} q={q} origRoom={origRoom} conversationsLoaded={conversationsLoaded} conversations={conversations} run={run} escape={escape} input={input} />}
      </div>
    </>
  );
}
