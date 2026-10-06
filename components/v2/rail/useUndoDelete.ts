import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { useChat } from "@/context/ChatProvider";
import { useHistory } from "@/features/history/view";
import type { Conversation } from "@/types/chat";
import { tokenMs } from "../motion";
import { reduced } from "./helpers";
import type { Gone } from "./Row";

type Chat = ReturnType<typeof useChat>;

const UNDO_MS = 5000;

/* ── deleting: a line you can take back, where the row was ───────────── */
export function useUndoDelete({
  root,
  conversations,
  activeConversationId,
  loadConversation,
  startNewConversation,
  hideTip,
  rollBack,
  say,
  setFocusId,
}: {
  root: RefObject<HTMLElement | null>;
  conversations: Conversation[];
  activeConversationId: Chat["activeConversationId"];
  loadConversation: Chat["loadConversation"];
  startNewConversation: Chat["startNewConversation"];
  hideTip: (now?: boolean) => void;
  rollBack: (only?: Element) => void;
  say: (t: string) => void;
  setFocusId: (id: string) => void;
}) {
  const history = useHistory();
  const [gone, setGone] = useState<Map<string, Gone>>(new Map());
  const wasActive = useRef(new Map<string, boolean>());
  const rings = useRef(new Map<string, Animation>());
  const byKey = useRef(new Set<string>());
  const setOne = (id: string, v: Gone | null) =>
    setGone((m) => {
      const n = new Map(m);
      if (v) n.set(id, v);
      else n.delete(id);
      return n;
    });

  const remove = (id: string, key: boolean) => {
    if (gone.has(id)) return;
    hideTip(true);
    rollBack();
    wasActive.current.set(id, id === activeConversationId);
    if (id === activeConversationId) startNewConversation();
    if (key) byKey.current.add(id);
    else if (root.current?.querySelector(`.sb-row[data-id="${id}"]`)?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    setOne(id, "leaving");
    say("Removed. Undo is there for five seconds.");
  };
  const undo = (id: string) => {
    const a = rings.current.get(id);
    if (a) {
      a.onfinish = null;
      a.cancel();
      rings.current.delete(id);
    }
    setOne(id, "back");
    window.setTimeout(() => setGone((m) => (m.get(id) === "back" ? new Map([...m].filter(([k]) => k !== id)) : m)), tokenMs("--d-mid"));
    if (wasActive.current.get(id)) loadConversation(id);
    setFocusId(id);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`.sb-row[data-id="${id}"] .sb-go`)?.focus({ preventScroll: true }));
    say("Chat restored.");
  };
  // the node leaves only once its close has run; then the chat is really deleted
  const finalised = useRef(new Set<string>());
  const finalise = useCallback(
    (id: string) => {
      if (finalised.current.has(id)) return;
      finalised.current.add(id);
      history?.remove(id).catch((error) => console.error("Could not delete the chat:", error));
    },
    [history]
  );
  const commit = (id: string) => {
    rings.current.delete(id);
    const row = root.current?.querySelector<HTMLElement>(`.sb-row[data-id="${id}"]`);
    const focusNext = !!row?.contains(document.activeElement);
    const next = row?.nextElementSibling?.getAttribute("data-id") ?? null;
    setOne(id, "gone");
    if (focusNext && next) {
      setFocusId(next);
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`.sb-row[data-id="${next}"] .sb-go`)?.focus({ preventScroll: true }));
    }
    if (reduced()) finalise(id);
    else window.setTimeout(() => finalise(id), tokenMs("--d-move") + 160);
  };
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  // each new undo line gets its ring, unwinding over five seconds
  useLayoutEffect(() => {
    gone.forEach((v, id) => {
      if (v !== "leaving" || rings.current.has(id)) return;
      const drain = root.current?.querySelector<SVGCircleElement>(`.sb-row[data-id="${id}"] .sb-drain`);
      if (!drain) return;
      const a = drain.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 100 }], { duration: UNDO_MS, easing: "linear", fill: "forwards" });
      a.onfinish = () => latestCommit.current(id);
      rings.current.set(id, a);
      if (byKey.current.delete(id))
        root.current?.querySelector<HTMLElement>(`.sb-row[data-id="${id}"] .sb-undo-b`)?.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    });
  }, [gone]);
  // a chat that is really gone leaves the map
  useEffect(() => {
    if (!gone.size) return;
    const ids = new Set(conversations.map((c) => c.id));
    let changed = false;
    const n = new Map(gone);
    n.forEach((_, id) => {
      if (!ids.has(id)) {
        n.delete(id);
        finalised.current.delete(id);
        changed = true;
      }
    });
    if (changed) setGone(n);
  }, [conversations, gone]);
  useEffect(() => {
    const r = rings.current;
    return () => r.forEach((a) => (a.onfinish = null));
  }, []);
  // the clock waits while the pointer rests on the line, or a keyboard user sits on Undo
  const ringOf = (t: EventTarget | null) => {
    const row = (t as Element | null)?.closest?.(".sb-row.is-leaving");
    return row ? { row, a: rings.current.get(row.getAttribute("data-id") ?? "") } : null;
  };
  return { gone, remove, undo, finalise, ringOf };
}
