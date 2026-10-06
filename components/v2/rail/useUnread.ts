import { useEffect, useRef, useState } from "react";

/* ── answering, and answered while you were elsewhere ───────────────── */
export function useUnread(liveId: string | null, activeConversationId: string | null) {
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const lastLive = useRef<string | null>(null);
  useEffect(() => {
    const was = lastLive.current;
    lastLive.current = liveId;
    if (was && !liveId && was !== activeConversationId) setUnread((s) => new Set(s).add(was));
  }, [liveId, activeConversationId]);
  const [active, setActive] = useState(activeConversationId);
  if (activeConversationId !== active) {
    setActive(activeConversationId);
    if (activeConversationId) setUnread((s) => (s.has(activeConversationId) ? new Set([...s].filter((x) => x !== activeConversationId)) : s));
  }
  return unread;
}
