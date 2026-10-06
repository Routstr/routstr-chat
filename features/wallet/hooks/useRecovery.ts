import { useEffect, useRef } from "react";
import type { MeltOutcome } from "@/features/book/settle";
import { recovery } from "@/runtime/book";
import { registerCommitter } from "./purseBridge";
import { useBook } from "./useBook";

/**
 * Settles what the signed-in account's operations left behind: on start, when
 * the tab comes back, and every minute. Mount it once for the app; the
 * recovery host already keeps it to one pass per account across tabs. While
 * mounted, the account's purse stores coins through its wallet.
 */
export function useRecovery(
  onMeltSettled: (quoteId: string, outcome: MeltOutcome) => void
) {
  const { owner, commitFor } = useBook();
  const report = useRef(onMeltSettled);
  useEffect(() => {
    report.current = onMeltSettled;
  });

  useEffect(() => {
    if (owner) return registerCommitter(owner, commitFor(owner));
  }, [owner, commitFor]);

  useEffect(() => {
    if (!owner) return;
    const run = async () => {
      const outcomes = await recovery.settle(owner, commitFor(owner));
      outcomes.forEach((outcome, quoteId) => report.current(quoteId, outcome));
    };
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    void run();
    const timer = setInterval(run, 60_000);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [owner, commitFor]);
}
