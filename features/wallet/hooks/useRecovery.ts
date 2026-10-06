import { useEffect, useRef } from "react";
import type { MeltOutcome } from "@/features/book/settle";
import { recovery } from "@/runtime/book";
import {
  registerCommitter,
  registerRecorder,
  setWalletLoading,
} from "./purseBridge";
import { useBook } from "./useBook";
import { useCashuHistory } from "./useCashuHistory";

/**
 * Settles what the signed-in account's operations left behind: on start, when
 * the tab comes back, and every minute. Mount it once for the app; the
 * recovery host already keeps it to one pass per account across tabs. While
 * mounted, the account's purse stores coins and writes activity through its
 * wallet, and the wallet view hears whether its coins are still loading.
 */
export function useRecovery(
  onMeltSettled: (quoteId: string, outcome: MeltOutcome) => void
) {
  const { owner, commitFor, isLoading } = useBook();
  const { createHistory } = useCashuHistory();
  const report = useRef(onMeltSettled);
  useEffect(() => {
    report.current = onMeltSettled;
  });

  useEffect(() => {
    if (owner) return registerCommitter(owner, commitFor(owner));
  }, [owner, commitFor]);
  useEffect(() => {
    if (owner) return registerRecorder(owner, createHistory);
  }, [owner, createHistory]);
  useEffect(() => {
    setWalletLoading(owner ?? null, isLoading);
  }, [owner, isLoading]);

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
