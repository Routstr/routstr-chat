"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import { Icon } from "../icons";
import { useUi } from "../ui";
import { groupByDay } from "../format";
import { useCountUp, useMoney } from "../useMoney";
import Wallet from "../wallet/Wallet";
import { RoomsButton, RoomsMenu } from "./RoomMenu";
import { BalanceButton } from "./BalanceButton";
import { ChatList } from "./ChatList";
import { Head } from "./Head";
import { cx, phoneNow } from "./helpers";
import { useArrivals } from "./useArrivals";
import { useBalance } from "./useBalance";
import { useDevice } from "./useDevice";
import { useDrawerFocus } from "./useDrawerFocus";
import { useFold } from "./useFold";
import { useGlide } from "./useGlide";
import { useGutter } from "./useGutter";
import { useListActions } from "./useListActions";
import { useLongTitles } from "./useLongTitles";
import { railHover } from "./railHover";
import { useRailKeys } from "./useRailKeys";
import { useRailTip } from "./useRailTip";
import { useSwipeRow } from "./useSwipeRow";
import { useTitleRoll } from "./useTitleRoll";
import { useTurn } from "./useTurn";
import { useUndoDelete } from "./useUndoDelete";
import { useUnread } from "./useUnread";

/* The rail card, chats side. It folds to a spine (the mark, New chat, search,
   the balance, the room and settings stay on it) while the reading panel grows
   into the room it gave up; nothing in the thread re-lays out. A deleted chat
   becomes a line you can take back for five seconds, where your eye already
   is. A cut title shows the rest of itself after a still moment. */

export default function Rail() {
  const {
    conversations,
    activeConversationId,
    loadConversation,
    startNewConversation,
    deleteConversation,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isLoading,
    streamingConversationId,
    conversationsLoaded,
  } = useChat();
  const { isAuthenticated } = useAuth();
  const ui = useUi();
  const money = useMoney();
  const shown = useCountUp(money.total);

  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const say = useCallback((t: string) => {
    const el = live.current;
    if (!el) return;
    el.textContent = "";
    window.setTimeout(() => (el.textContent = t), 30);
  }, []);

  const { phone, mac } = useDevice();
  const K = (k: string, shift = false) => (mac ? `${shift ? "⇧" : ""}⌘${k}` : `Ctrl ${shift ? "Shift " : ""}${k}`);
  const folded = isSidebarCollapsed && !phone;

  const finding = isAuthenticated && !conversationsLoaded;
  const none = !finding && conversations.length === 0;
  const liveId = isLoading ? streamingConversationId : null;

  const [focusId, setFocusId] = useState<string | null>(null);
  /* ── rooms ──────────────────────────────────────────────────────────── */
  const [rooms, setRooms] = useState(false);

  const { tipFor, hideTip, showTip, armTip } = useRailTip({ root, tip, list, folded, K, money });
  const { rollBack, armRoll } = useTitleRoll({ folded, showTip, hideTip });
  const { gone, remove, undo, finalise, ringOf } = useUndoDelete({
    root,
    conversations,
    activeConversationId,
    loadConversation,
    startNewConversation,
    deleteConversation,
    hideTip,
    rollBack,
    say,
    setFocusId,
  });
  const unread = useUnread(liveId, activeConversationId);

  /* ── groups, arrivals ─────────────────────────────────────────────────── */
  const groups = useMemo(() => groupByDay(conversations), [conversations]);
  const { arriving, titled, arrivingList } = useArrivals({ list, finding, conversations, conversationsLoaded, isAuthenticated });
  const long = useLongTitles(list, groups, activeConversationId, phone);

  /* ── the keyboard: the list is one Tab stop ─────────────────────────── */
  const tabId =
    (focusId && conversations.some((c) => c.id === focusId) && gone.get(focusId) !== "gone" && focusId) ||
    activeConversationId ||
    groups[0]?.items[0]?.id ||
    null;

  const { edges, onScroll } = useGlide({ root, list, finding, activeConversationId, hideTip });
  const setFold = useFold({ root, list, shade, folded, isSidebarCollapsed, setIsSidebarCollapsed, hideTip, rollBack, setRooms, edges, say });
  const turn = useTurn({ root, clip, shade, ui, folded, setFold, hideTip, setRooms });
  const { delta, zero, waitN, balWait } = useBalance(money, isAuthenticated);
  useGutter(list, root);
  useDrawerFocus(root, ui, phone);

  /* ── actions ────────────────────────────────────────────────────────── */
  const open = (id: string) => {
    setFocusId(id);
    loadConversation(id);
    ui.setDrawer(false);
  };
  const fresh = () => {
    startNewConversation();
    ui.setDrawer(false);
    ui.setFace("write");
  };

  useRailKeys({ ui, isSidebarCollapsed, setFold, turn, hideTip });
  const { swDown, swMove, swEnd, openRow, closeOpen, justSwiped } = useSwipeRow(ui);
  const { delAt, onListClick, onListKey, onListEnd } = useListActions({ list, remove, undo, open, finalise, setFocusId, openRow, closeOpen, justSwiped });
  const { onRailOver, onRailMove, onRailOut, onListFocus, onListBlur } = railHover({ tip, folded, tipFor, armTip, hideTip, armRoll, rollBack, ringOf, delAt });

  const newCurrent = !finding && !activeConversationId;
  return (
    <aside
      className="rail sb"
      data-furniture="rail"
      aria-label="Chats and wallet"
      role={phone && ui.drawer ? "dialog" : undefined}
      aria-modal={phone && ui.drawer ? true : undefined}
      ref={root}
      data-fold={folded ? "" : undefined}
      inert={phone && !ui.drawer}
      onPointerOver={onRailOver}
      onPointerMove={onRailMove}
      onPointerOut={onRailOut}
      onPointerLeave={() => {
        hideTip();
        rollBack();
      }}
      onPointerDown={() => hideTip(true)}
    >
      <div className="card sb-card">
        <div className="sb-shade" ref={shade} aria-hidden="true" />
        <div className="sb-clip" ref={clip}>
          <div className="sb-clip-in">
            <div className="flip" data-side={ui.side}>
              <div className="face front" inert={ui.side !== "chats"}>
                <div className="sb-in">
                  <Head ui={ui} folded={folded} mac={mac} phone={phone} none={none} newCurrent={newCurrent} K={K} setFold={setFold} fresh={fresh} />
                  <nav
                    className={cx("sb-list", arrivingList && "is-arriving")}
                    aria-label="Chats"
                    ref={list}
                    inert={folded}
                    onScroll={onScroll}
                    onClick={onListClick}
                    onKeyDown={onListKey}
                    onFocus={onListFocus}
                    onBlur={onListBlur}
                    onTransitionEnd={onListEnd}
                    onPointerDown={swDown}
                    onPointerMove={swMove}
                    onPointerUp={swEnd}
                    onPointerCancel={swEnd}
                    onContextMenu={(e) => phoneNow() && (e.target as Element).closest(".sb-go") && e.preventDefault()}
                  >
                    <ChatList
                      finding={finding}
                      none={none}
                      groups={groups}
                      gone={gone}
                      arriving={arriving}
                      titled={titled}
                      arrivingList={arrivingList}
                      activeConversationId={activeConversationId}
                      liveId={liveId}
                      unread={unread}
                      long={long}
                      tabId={tabId}
                    />
                  </nav>
                  <button type="button" className="sb-spine" tabIndex={-1} aria-hidden="true" data-tipk="fold" onClick={() => setFold(false)}>
                    <Icon name="right" size={16} />
                  </button>
                  <footer className="sb-foot">
                    <BalanceButton money={money} shown={shown} zero={zero} balWait={balWait} waitN={waitN} delta={delta} onClick={() => turn("wallet")} />
                    <div className="sb-tools">
                      <RoomsButton open={rooms} onToggle={() => setRooms((o) => !o)} />
                      <button type="button" className="ghost sb-gear" data-tipk="gear" aria-label="Settings" onClick={() => ui.openSettings()}>
                        <Icon name="gear" />
                      </button>
                    </div>
                  </footer>
                </div>
              </div>
              <div className="face back" inert={ui.side !== "wallet"}>
                <Wallet />
              </div>
            </div>
          </div>
        </div>
      </div>
      {rooms && (
        <RoomsMenu
          onClose={(refocus) => {
            setRooms(false);
            if (refocus) root.current?.querySelector<HTMLElement>(".sb-sw")?.focus({ preventScroll: true });
          }}
        />
      )}
      <div className="sb-tip" ref={tip} aria-hidden="true" />
      <p className="sr" aria-live="polite" ref={live} />
    </aside>
  );
}
