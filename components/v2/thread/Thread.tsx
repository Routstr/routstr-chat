"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useHistory, useThread, type ThreadSlot } from "@/features/history/view";
import { getTextFromContent } from "@/utils/messageUtils";
import { useActions } from "../useActions";
import { shortModelName } from "../format";
import { Icon } from "../icons";
import { tokenMs } from "../motion";
import { Answer } from "./answer/Answer";
import type { Go } from "./atoms/helpers";
import { Mine } from "./mine/Mine";
import { Tips } from "./Tips";
import Live from "./Live";
import Trouble, { DECLINED, isStopped } from "./Trouble";

const NO_SLOTS: ThreadSlot[] = [];

/* ══ the thread ════════════════════════════════════════════════════════════ */
export default function Thread({ loadingFromUrl }: { loadingFromUrl: boolean }) {
  const {
    models,
    selectedModel,
    isLoading,
    streamingConversationId,
    activeConversationId,
    getStreamingContentFor,
    editingMessageIndex,
    startEditingMessage,
    messages,
  } = useChat();
  // the versions picked live in history, so the model is sent the branch shown here
  const history = useHistory();
  const slots = useThread(activeConversationId) ?? NO_SLOTS;
  // messages: the same branch with what each reply cost, then the last request's notes
  const notes = messages.slice(slots.length);
  // a stop after some words belongs to that answer
  const stoppedAnswer = notes.length === 1 && isStopped(notes[0]) && slots.at(-1)?.displayed.role === "assistant";

  const modelOf = useCallback(
    (id?: string) => (id ? models.find((x) => x.id === id) ?? (selectedModel?.id === id ? selectedModel : undefined) : undefined),
    [models, selectedModel]
  );
  const modelName = useCallback((id?: string) => (id ? shortModelName(modelOf(id)?.name, id).toLowerCase() : "assistant"), [modelOf]);
  const fullName = useCallback((id?: string) => (id ? shortModelName(modelOf(id)?.name, id) : "assistant"), [modelOf]);

  const liveHere =
    isLoading && (!streamingConversationId || streamingConversationId === activeConversationId);
  // the stored answer and the streaming copy can overlap for a frame
  const streamingText = getStreamingContentFor(activeConversationId);

  // stable handlers, so memoised messages do not re-render on every token
  const slotsRef = useRef(slots);
  useLayoutEffect(() => {
    slotsRef.current = slots;
  });
  // another version is another message, so the turn remounts: the arrow you pressed keeps the keyboard
  const refocus = useRef<{ depth: number; label: string } | null>(null);
  const onVersion = useCallback<Go>(
    (depth, d) => {
      const slot = slotsRef.current[depth];
      if (!slot || !activeConversationId) return;
      const next = Math.min(slot.keys.length - 1, Math.max(0, slot.displayedIndex + d));
      const a = document.activeElement;
      if (a?.closest(".rd-vers")) refocus.current = { depth, label: a.getAttribute("aria-label") ?? "" };
      history?.selectVersion(activeConversationId, depth, slot.keys[next]);
    },
    [history, activeConversationId]
  );
  const actions = useActions();
  const latest = useRef({ retry: actions.retry, edit: startEditingMessage });
  useLayoutEffect(() => {
    latest.current = { retry: actions.retry, edit: startEditingMessage };
  });
  const onRetry = useCallback((i: number) => latest.current.retry(i), []);
  const onEdit = useCallback((i: number) => latest.current.edit(i), []);

  /* ── scrolling: the question rides at the top, the answer grows under it,
        and any scroll by you wins ─────────────────────────────────────────── */
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const r = refocus.current;
    if (!r) return;
    refocus.current = null;
    // a turn's index is its depth
    scroller.current?.querySelector<HTMLElement>(`[data-index="${r.depth}"] .rd-vers [aria-label="${r.label}"]`)?.focus({ preventScroll: true });
  });
  const [reserve, setReserve] = useState(0);
  const follow = useRef(false);
  const userScrolled = useRef(false);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  const lastUserKey = useRef<string | null>(null);
  const convRef = useRef<string | null | undefined>(undefined);

  const lastSlot = slots[slots.length - 1];
  const lastUserDepth = slots.findLastIndex((s) => s.displayed.role === "user");
  const lastUser = slots[lastUserDepth];
  const userKey = lastUser ? `${lastUserDepth}:${lastUser.displayed._createdAt}` : null;

  // a chat opened: straight to its end, no animation
  useLayoutEffect(() => {
    if (convRef.current === activeConversationId && !loadingFromUrl) return;
    convRef.current = activeConversationId;
    lastUserKey.current = userKey;
    setReserve(0);
    setAway(false);
    pinned.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeConversationId, loadingFromUrl, slots.length > 0]);

  // you sent something: make room under it and bring it to the top
  useLayoutEffect(() => {
    if (!userKey || userKey === lastUserKey.current) return;
    lastUserKey.current = userKey;
    if (!isLoading) return;
    const el = scroller.current;
    const q = el?.querySelector<HTMLElement>(`.rd-me[data-index="${lastUserDepth}"]`);
    if (!el || !q) return;
    const h = q.offsetHeight;
    setReserve(Math.max(0, el.clientHeight - h - 120));
    follow.current = false;
    requestAnimationFrame(() => {
      // a long question settles to its clamp a frame late: size the room
      // from the height it settled at, then scroll once that has committed
      const h2 = q.offsetHeight;
      if (h2 !== h) setReserve(Math.max(0, el.clientHeight - h2 - 120));
      requestAnimationFrame(() => el.scrollTo({ top: q.offsetTop - 28, behavior: "smooth" }));
    });
  }, [userKey, isLoading]);

  // a fold already handed its space back
  const folding = useRef(false);
  // the answer outgrew the room we made: follow its tail, until you scroll
  useEffect(() => {
    const el = scroller.current;
    const box = inner.current;
    if (!el || !box) return;
    let lastH = box.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = box.offsetHeight;
      const grew = h - lastH;
      lastH = h;
      if (!grew) return;
      if (!isLoading) {
        // a picture landed in a chat you are reading at its end: stay at the end
        if (pinned.current && grew > 0) el.scrollTop = el.scrollHeight;
        const gap = el.scrollHeight - reserve - (el.scrollTop + el.clientHeight);
        setAway(gap > 240);
        return;
      }
      if (grew < 0) {
        // the fold already paid for this; anything else that folds away
        // hands its space back as reserve, so nothing you are reading moves
        if (!folding.current) setReserve((r) => r - grew);
        return;
      }
      const tailBelow = box.offsetTop + h - (el.scrollTop + el.clientHeight);
      if (reserve > 0) {
        // eat the reserved space first
        setReserve((r) => Math.max(0, r - grew));
      }
      if (tailBelow > 0 && follow.current) el.scrollTop += tailBelow + 8;
      else if (tailBelow > 0 && tailBelow < 140 && !userScrolled.current) {
        follow.current = true;
        el.scrollTop += tailBelow + 8;
      }
      // the answer grows below someone reading further up: the way back appears without a scroll
      else setAway(el.scrollHeight - reserve - (el.scrollTop + el.clientHeight) > 240);
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [isLoading, reserve]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const release = () => {
      userScrolled.current = true;
      follow.current = false;
    };
    const onScroll = () => {
      // a keyboard ride is running: its transform is not the reader scrolling away (it is worked out
      // again from the settled layout when the ride ends)
      if (inner.current?.getAnimations().length) return;
      const gap = el.scrollHeight - reserve - (el.scrollTop + el.clientHeight);
      setAway(gap > 240);
      pinned.current = gap < 24;
      if (gap < 24) userScrolled.current = false;
    };
    // reading back without a wheel: the keys that scroll up, or a grab of
    // the scrollbar (a press on the scroller outside its content box)
    const keys = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input, [contenteditable]")) return;
      if (["PageUp", "ArrowUp", "Home"].includes(e.key) || (e.key === " " && e.shiftKey)) release();
    };
    const grab = (e: PointerEvent) => {
      if (e.target === el && (e.offsetX > el.clientWidth || e.offsetY > el.clientHeight)) release();
    };
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("touchmove", release, { passive: true });
    el.addEventListener("keydown", keys);
    el.addEventListener("pointerdown", grab);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", release);
      el.removeEventListener("touchmove", release);
      el.removeEventListener("keydown", keys);
      el.removeEventListener("pointerdown", grab);
      el.removeEventListener("scroll", onScroll);
    };
  }, [reserve]);

  useEffect(() => {
    if (!isLoading) userScrolled.current = false;
  }, [isLoading]);

  // the composer grew (a longer draft, attachments): the thread gives up the
  // height from its top, so the words you were reading at the end stay put
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let lastH = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      const phoneRide = (from: number, d: string) => {
        if (!inner.current || !window.matchMedia("(max-width: 760px)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const ride = inner.current.animate([{ transform: `translateY(${from}px)` }, { transform: "none" }], {
          duration: tokenMs(d),
          easing: getComputedStyle(document.documentElement).getPropertyValue("--e-out").trim() || "ease-out",
        });
        // settled: pinned and away are read again from the real layout
        ride.finished.then(() => el.dispatchEvent(new Event("scroll"))).catch(() => undefined);
      };
      // the keyboard going down: the words ride down with the composer too (an exit, one step faster)
      if (h - lastH >= 40 && pinned.current) phoneRide(-(h - lastH), "--d-mid");
      if (h < lastH && pinned.current) {
        el.scrollTop = el.scrollHeight - reserve - h;
        // a phone's keyboard: the words ride up with the composer (its FLIP) instead of leaping ahead
        if (lastH - h >= 40) phoneRide(lastH - h, "--d-move");
      }
      lastH = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [reserve]);

  const onFold = useCallback((h: number, ms: number) => {
    if (!h) return;
    folding.current = true;
    setReserve((r) => r + h);
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        folding.current = false;
        // settle once, to exactly what holds the scroll where it is
        const el = scroller.current;
        const box = inner.current;
        if (!el || !box) return;
        setReserve((r) => Math.max(0, Math.round(el.scrollTop + el.clientHeight - (box.offsetTop + box.offsetHeight))));
      });
    }, ms + 40);
  }, []);

  const toEnd = () => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight - reserve - el.clientHeight + 24, behavior: reduce ? "auto" : "smooth" });
    // the button leaves once used: the words take the keys again
    document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus({ preventScroll: true });
  };

  // it belongs to the composer: centred over Send, measured on show and on resize
  const wrap = useRef<HTMLDivElement>(null);
  const [jumpX, setJumpX] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!away) return;
    const place = () => {
      const w = wrap.current?.getBoundingClientRect();
      const go = document.querySelector(".dock .go")?.getBoundingClientRect();
      if (!w || !go) return;
      const size = window.innerWidth <= 760 ? 44 : 36;
      setJumpX(Math.round(go.left + go.width / 2 - w.left - size / 2));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [away]);

  const hideStoredTail =
    liveHere && lastSlot?.displayed.role === "assistant" && streamingText && getTextFromContent(lastSlot.displayed.content) === streamingText;

  // messages already here when a chat opens arrive still; new ones rise in,
  // once: after its rise a turn is known, so a remount (another version) stays still
  const slotKeys = slots.map((s) => s.displayed._eventId);
  const [known, setKnown] = useState({ conv: activeConversationId, keys: new Set(slotKeys) });
  if (known.conv !== activeConversationId) setKnown({ conv: activeConversationId, keys: new Set(slotKeys) });
  const keyList = slotKeys.join(" ");
  useEffect(() => {
    if (slotKeys.every((k) => known.keys.has(k))) return;
    const t = window.setTimeout(() => setKnown((k) => ({ ...k, keys: new Set([...k.keys, ...slotKeys]) })), tokenMs("--d-move"));
    return () => window.clearTimeout(t);
  }, [keyList, known]);

  // one polite line for screen readers when an answer lands (trouble says
  // itself: it mounts as a status or an alert)
  const [said, setSaid] = useState("");
  const [wasLive, setWasLive] = useState(liveHere);
  if (wasLive !== liveHere) {
    setWasLive(liveHere);
    const last = slots[slots.length - 1]?.displayed;
    if (!liveHere && last?.role === "assistant") setSaid(`${fullName(last._modelId)} ${stoppedAnswer ? "stopped part way" : "answered"}.`);
  }

  return (
    <div className="thread-wrap" ref={wrap}>
    <Tips scope={wrap} />
    <p className="sr" aria-live="polite">
      {said}
    </p>
    <div className="thread scroll" ref={scroller}>
      <div className="thread-box">
      <div className="thread-in" ref={inner}>
        {loadingFromUrl && slots.length === 0 ? (
          <div className="ghost-lines" aria-label="Opening chat">
            <i /><i /><i />
          </div>
        ) : (
          slots.map((slot, depth) => {
            const msg = messages[depth];
            const isLast = depth === slots.length - 1 && !liveHere;
            if (hideStoredTail && depth === slots.length - 1) return null;
            const v = { depth, vAt: slot.displayedIndex + 1, vOf: slot.keys.length };
            const key = slot.displayed._eventId;
            if (msg.role === "user")
              return (
                <Mine key={key} msg={msg} index={depth} {...v} isLast={isLast} busy={isLoading}
                  editing={editingMessageIndex === depth} fresh={!known.keys.has(key)}
                  onVersion={onVersion} onEdit={onEdit} />
              );
            if (DECLINED.test(getTextFromContent(msg.content)))
              return <Trouble key={key} msgs={[msg]} index={depth} isLast={isLast} label={modelName(msg._modelId)} model={fullName(msg._modelId)} />;
            return (
              <Answer key={key} msg={msg} index={depth} {...v} isLast={isLast} busy={isLoading}
                label={modelName(msg._modelId)} full={fullName(msg._modelId)} stopped={stoppedAnswer && depth === slots.length - 1} onVersion={onVersion} onRetry={onRetry} />
            );
          })
        )}
        {!liveHere && notes.length > 0 && !stoppedAnswer && (
          <Trouble msgs={notes} index={slots.length} isLast label={modelName(selectedModel?.id)} model={fullName(selectedModel?.id)} />
        )}
        {liveHere && (
          <Live
            key={userKey ?? "live"}
            label={modelName(selectedModel?.id)}
            prompt={lastUser ? getTextFromContent(lastUser.displayed.content) : ""}
            onFold={onFold}
          />
        )}
      </div>
      </div>
      <div className="thread-foot" style={{ "--reserve": `${reserve}px` } as React.CSSProperties} />
    </div>
      <button
        className="rd-latest"
        onClick={toEnd}
        aria-label={liveHere ? "New words below. Go to the latest" : "Go to the latest message"}
        tabIndex={away ? 0 : -1}
        aria-hidden={!away || undefined}
        data-on={away && jumpX !== null ? "" : undefined}
        data-live={away && liveHere ? "" : undefined}
        style={{ left: jumpX ?? 0 }}
      >
        <Icon name="arrowDown" size={17} />
      </button>
    </div>
  );
}
