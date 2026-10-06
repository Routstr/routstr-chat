"use client";

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useConversations, useHistoryLoaded } from "@/features/history/view";
import { useSession } from "@/features/session/view";

/* Which chat is open in this tab. Each account keeps its own: a switch opens
   that account's last chat here, or a new one. A ?chatId= link wins when the
   page loads, and the address follows the open chat. */

export interface OpenChat {
  /** The open chat; null is a new chat not yet asked. */
  id: string | null;
  open: (id: string) => void;
  openNew: () => void;
  /** The open chat now, for code that runs after an await. */
  current: () => string | null;
}

const OpenChatContext = createContext<OpenChat | null>(null);

export function useOpenChat(): OpenChat {
  const v = useContext(OpenChatContext);
  if (!v) throw new Error("useOpenChat must be used inside OpenChatProvider");
  return v;
}

// this tab's last open chat per account; the page's own link counts only on the first mount
const tab = { lastOpen: new Map<string, string | null>(), linkTaken: false };

export function OpenChatProvider({ initial, children }: { initial?: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const linked = params.get("chatId");
  // the same key added twice is two accounts, each with its own chats
  const owner = useSession().accountId ?? "";
  const conversations = useConversations();
  const loaded = useHistoryLoaded();

  const [fromLink] = useState(() => initial === undefined && !tab.linkTaken && !!linked);
  const [id, setId] = useState<string | null>(() => {
    if (initial !== undefined) return initial;
    if (fromLink && linked) return linked;
    return tab.lastOpen.get(owner) ?? null;
  });
  useEffect(() => {
    tab.linkTaken = true;
  }, []);
  // a linked chat this device does not have: the latest one opens instead, once there are chats
  // (a signed-out page, or history still coming in, waits with the link as it is)
  const [checked, setChecked] = useState(!fromLink);
  if (!checked && loaded && conversations.length > 0) {
    setChecked(true);
    if (id && !conversations.some((c) => c.id === id)) setId(conversations[0]?.id ?? null);
  }

  const now = useRef(id);
  useLayoutEffect(() => {
    now.current = id;
  });
  useEffect(() => {
    tab.lastOpen.set(owner, id);
  }, [owner, id]);

  // the address follows: ?chatId= names the open chat, or goes for a new one
  const qs = params.toString();
  useEffect(() => {
    if (initial !== undefined) return;
    const p = new URLSearchParams(qs);
    if ((p.get("chatId") ?? null) === id) return;
    if (id) p.set("chatId", id);
    else p.delete("chatId");
    const next = p.toString();
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }, [id, qs, pathname, router, initial]);

  const open = useCallback((next: string) => {
    now.current = next;
    setId(next);
  }, []);
  const openNew = useCallback(() => {
    now.current = null;
    setId(null);
  }, []);
  const current = useCallback(() => now.current, []);
  const value = useMemo(() => ({ id, open, openNew, current }), [id, open, openNew, current]);
  return <OpenChatContext.Provider value={value}>{children}</OpenChatContext.Provider>;
}
