import React, { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { Conversation } from "@/types/chat";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/components/ClientProviders";
import { useHistory } from "@/features/history/view";
import { useDeviceRelays } from "@/features/relays/view";
import type { Item, Sync, SyncOutcome } from "./types";

/* ── sync: the row turns its glyph, then says what came in ────────────── */
export function useSync({
  it,
  conversations,
  sync,
  setSync,
  setCame,
}: {
  it: Item | undefined;
  conversations: Conversation[];
  sync: Sync;
  setSync: (s: Sync) => void;
  setCame: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const syncT = useRef({ start: 0, before: new Set<string>(), timers: [] as number[] });
  // the result stays while you look at it: it clears once the selection leaves Sync
  const onSync = useRef(false);
  onSync.current = it?.id === "sync";
  const idleLater = useRef(false);
  useEffect(() => {
    if (onSync.current || !idleLater.current) return;
    idleLater.current = false;
    setSync("idle");
    setCame([]);
  }, [it?.id]);
  const convRef = useRef(conversations);
  convRef.current = conversations;
  const { manager } = useAccountManager();
  const account = useObservableState(manager.active$);
  const history = useHistory();
  const [relays] = useDeviceRelays();
  const syncCtx = useRef({ active: false, relays: 0 });
  syncCtx.current = { active: !!account, relays: relays.length };
  const finishSync = useCallback((outcome: SyncOutcome) => {
    const s = syncT.current;
    // the glyph turns for a moment at least, so a quick sync still reads as one
    const wait = Math.max(0, 900 - (performance.now() - s.start));
    s.timers.push(
      window.setTimeout(() => {
        // a skipped sync says why, from what the app knows: no key, no relays, or a signer that did not answer
        const why = !syncCtx.current.active ? "nokey" : !syncCtx.current.relays ? "norelay" : "slow";
        setSync(outcome === "ok" ? "done" : outcome === "offline" ? why : "fail");
        s.timers.push(
          window.setTimeout(() => {
            if (onSync.current) return void (idleLater.current = true);
            setSync("idle");
            setCame([]);
          }, 2600)
        );
      }, wait)
    );
  }, []);
  // chats that came in are counted as they decrypt, not only when the sync ends, and before paint,
  // so a new row, its fade and '+N new' land in the same frame (never plain first, then faded)
  useLayoutEffect(() => {
    if (sync !== "running" && sync !== "done") return;
    const s = syncT.current;
    const ids = conversations.filter((c) => !s.before.has(c.id)).map((c) => c.id);
    setCame((was) => (was.length === ids.length && was.every((id, i) => id === ids[i]) ? was : ids));
  }, [sync, conversations]);
  useEffect(() => () => syncT.current.timers.forEach((t) => window.clearTimeout(t)), []);
  const runSync = async () => {
    if (sync === "running") return;
    const s = syncT.current;
    s.timers.forEach((t) => window.clearTimeout(t));
    s.timers = [];
    s.start = performance.now();
    s.before = new Set(conversations.map((c) => c.id));
    setCame([]);
    setSync("running");
    // the sync says how it ended; a relay that never answers counts as a failure after a while
    const late = new Promise<SyncOutcome>((r) => s.timers.push(window.setTimeout(() => r("failed"), 20_000)));
    const outcome = await Promise.race([history?.sync() ?? Promise.resolve<SyncOutcome>("offline"), late]).catch(() => "failed" as const);
    finishSync(outcome);
  };
  return runSync;
}
