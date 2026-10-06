"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useChat } from "@/context/ChatProvider";
import { Icon } from "./icons";
import { useUi } from "./ui";
import { useRoom } from "./room/RoomProvider";
import Rail from "./rail/Rail";
import Thread from "./thread/Thread";
import Composer from "./composer/Composer";
import { land } from "./composer/landing";
import ModelPicker from "./picker/ModelPicker";
import Palette from "./palette/Palette";
import Settings from "./settings/Settings";
import Greeting, { Ideas, Resume } from "./Greeting";
import { useCountUp, useMoney } from "./useMoney";
import { useAuth } from "@/context/AuthProvider";
import { useConversations, useHistoryLoaded } from "@/features/history/view";
import { sats } from "./format";
import { useDrawerDrag, useKeyboardInset, usePhone } from "./phone";

function Panel() {
  const searchParams = useSearchParams();
  const chatIdFromUrl = searchParams.get("chatId");
  const { messages, activeConversationId, isSidebarCollapsed, startNewConversation } = useChat();
  const conversations = useConversations();
  const conversationsLoaded = useHistoryLoaded();
  const ui = useUi();
  const room = useRoom();
  const money = useMoney();
  // a title too long for the header fades at its end, as the drawer's titles do (never dots)
  const titleIn = useRef<HTMLSpanElement>(null);
  const { isAuthenticated } = useAuth();
  // the same figure as the drawer's: a wait mark while it loads, then counted up
  const balWait = !money.node && money.loading && isAuthenticated;
  const shownBal = useCountUp(money.total);

  const loadingFromUrl =
    !!chatIdFromUrl &&
    !(chatIdFromUrl === activeConversationId && messages.length > 0) &&
    !conversationsLoaded;
  const empty = messages.length === 0 && !loadingFromUrl;
  // whether this new page is a first visit is decided once, when the chats have loaded, and
  // kept for the page: chats that arrive later (a sync) fade the first-run extras, they do not
  // reshape the page under the reader
  const [firstPage, setFirstPage] = useState<boolean | null>(null);
  useEffect(() => {
    if (!empty) return setFirstPage(null);
    if (firstPage === null && conversationsLoaded) setFirstPage(conversations.length === 0);
  }, [empty, conversationsLoaded, conversations.length, firstPage]);
  const firstGone = !!firstPage && conversations.length > 0;

  const title = useMemo(
    () => conversations.find((c) => c.id === activeConversationId)?.title ?? "",
    [conversations, activeConversationId]
  );
  useLayoutEffect(() => {
    const t = titleIn.current;
    if (!t) return;
    const cut = () => t.toggleAttribute("data-cut", t.scrollWidth > t.clientWidth + 1);
    cut();
    const ro = new ResizeObserver(cut);
    ro.observe(t);
    return () => ro.disconnect();
  }, [title]);

  // The composer is one object. When the first message leaves the centre,
  // it travels to the dock from exactly where it was (see composer/landing).
  const dockRef = useRef<HTMLDivElement>(null);
  const [arriving, setArriving] = useState(false);
  const wasEmpty = useRef(empty);
  useLayoutEffect(() => {
    if (wasEmpty.current && !empty) {
      const el = dockRef.current?.querySelector<HTMLElement>(".island");
      if (el) land(el);
      setArriving(true);
      const t = window.setTimeout(() => setArriving(false), 520);
      wasEmpty.current = empty;
      return () => window.clearTimeout(t);
    }
    wasEmpty.current = empty;
  }, [empty]);

  useEffect(() => {
    room.measure();
  }, [room, empty, isSidebarCollapsed]);

  // phone: the composer floats over the card's foot, so the thread keeps its
  // height as room at its end (only while it writes: a turned card must not
  // re-lay the thread)
  useLayoutEffect(() => {
    const d = dockRef.current;
    const panel = d?.parentElement;
    if (!d || !panel) return;
    const set = () => {
      if (ui.face !== "write") return;
      // a reader at the end stays at the end as the composer grows over it
      const t = panel.querySelector<HTMLElement>(".thread");
      const atEnd = !!t && t.scrollHeight - t.scrollTop - t.clientHeight < 24;
      panel.style.setProperty("--dock-h", `${Math.round(d.offsetHeight)}px`);
      if (t && atEnd) t.scrollTop = t.scrollHeight;
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(d);
    return () => ro.disconnect();
  }, [ui.face]);

  const fresh = () => {
    startNewConversation();
    ui.setFace("write");
  };

  return (
    <main
      // folded, the panel's left clip opens and its content slides into the room the card gave up
      className={isSidebarCollapsed ? "panel is-shifted" : "panel"}
      data-furniture="panel"
      data-state={empty ? "empty" : "chat"}
      data-first={empty && firstPage ? "" : undefined}
      // the phone drawer is modal: the page behind it is out of reach
      inert={ui.drawer || undefined}
      data-arriving={arriving ? "" : undefined}
    >
      {/* phone: the card the panel stands on, and the room's colour that sinks it when it steps back */}
      <div className="pcard" aria-hidden="true" />
      <div className="catch" aria-hidden="true" />
      <header className="panel-head">
        <div className="lead">
          <button className="ghost only-m" onClick={() => ui.setDrawer(true)} aria-label="Open chats">
            <Icon name="menu" />
          </button>
        </div>
        {!empty && title ? (
          <button className="title" onClick={() => ui.setPalette(true)} title="Search chats" aria-label={`Search chats. Current chat: ${title}`}>
            <span className="title-in" key={title} ref={titleIn}>
              {title}
            </span>
            <Icon name="down" size={13} className="title-chev" />
          </button>
        ) : (
          <span className="title" />
        )}
        <div className="trail">
          {/* a phone's way to a new chat; on a desktop the rail (or its spine) has it.
              On a phone's new chat the balance stands here instead, one tap from the wallet */}
          {!empty ? (
            <button className="ghost only-m" onClick={fresh} aria-label="New chat">
              <Icon name="edit" />
            </button>
          ) : (
            (
              // (a node paying: the header keeps its two ends, in the drawer's own word)
              <button
                className="head-bal only-m"
                data-zero={!money.node && !balWait && money.total <= 0 ? "" : undefined}
                aria-label={money.node ? "Wallet, your node pays" : balWait ? "Wallet, balance loading" : `Wallet, ${sats(money.total)} sats`}
                onClick={() => window.dispatchEvent(new Event("v2:wallet"))}
              >
                {money.node ? (
                  <span className="node">Node</span>
                ) : balWait ? (
                  <span className="w" aria-hidden="true" />
                ) : (
                  <>
                    <span className="n">{sats(shownBal)}</span>
                    <span className="u">sats</span>
                  </>
                )}
              </button>
            )
          )}
        </div>
      </header>

      {empty ? <Greeting first={firstPage} gone={firstGone} /> : <Thread loadingFromUrl={loadingFromUrl} />}

      <div className="dock" data-furniture="dock" ref={dockRef}>
        <div className="slot">
          <Composer centred={empty} />
        </div>
      </div>

      {empty && (
        <div className="stage-tail">
          {firstPage && <Ideas gone={firstGone} />}
          {firstPage === false && <Resume />}
        </div>
      )}
    </main>
  );
}

export default function Shell() {
  const { isSidebarCollapsed, setIsSidebarCollapsed, isLoading, startNewConversation } = useChat();
  const conversations = useConversations();
  const ui = useUi();
  const room = useRoom();
  const roomEl = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  useKeyboardInset(phone);
  useDrawerDrag(roomEl, ui.drawer, ui.setDrawer, phone);
  // the drawer is a phone thing: widening the window (or turning the phone) puts it away
  useEffect(() => {
    if (!phone && ui.drawer) ui.setDrawer(false);
  }, [phone, ui]);

  // The rail is set down the first time it has something to hold. After
  // that it is yours: hidden or shown, it stays that way.
  useEffect(() => {
    if (!conversations.length) return;
    try {
      if (localStorage.getItem("routstr.rail.placed")) return;
      localStorage.setItem("routstr.rail.placed", "1");
    } catch {
      return;
    }
    setIsSidebarCollapsed(false);
  }, [conversations.length, setIsSidebarCollapsed]);

  // ⌘K / Ctrl K anywhere; Escape closes what is on top
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // during the boot the key ends first light (Boot's own listener); the palette opens once the
        // room is awake, never under the boot mark
        if (document.querySelector(".pf-bootlayer")) {
          const t0 = performance.now();
          const wait = () =>
            !document.querySelector(".pf-bootlayer") ? ui.setPalette(true) : performance.now() - t0 < 10_000 && requestAnimationFrame(wait);
          requestAnimationFrame(wait);
          return;
        }
        ui.setPalette(!ui.palette);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        startNewConversation();
        ui.setFace("write");
        return;
      }
      // start typing anywhere and the words go to the composer (Space stays with a focused button)
      const t = e.target as HTMLElement | null;
      const typing = t?.closest?.("input, textarea, select, [contenteditable='true'], [role='dialog']");
      // (never while the palette is up: its field has the keys, whatever holds the focus)
      if (!typing && !ui.palette && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && e.key !== " " && ui.face === "write") {
        document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui, startNewConversation]);

  // the room holds still while words arrive
  useEffect(() => {
    if (!isLoading) room.setPhase("idle");
  }, [isLoading, room]);

  return (
    <div className="v2">
      <div
        className="room"
        ref={roomEl}
        data-drawer={ui.drawer ? "open" : undefined}
        // a phone: a sheet over the panel lets the panel step back into the room
        data-back={phone && (ui.picker || ui.palette) ? "" : undefined}
      >
        <Rail />
        <div className="drawer-veil" onClick={() => ui.setDrawer(false)} aria-hidden="true" />
        <Panel />
      </div>
      <ModelPicker />
      <Palette />
      <Settings />
    </div>
  );
}
