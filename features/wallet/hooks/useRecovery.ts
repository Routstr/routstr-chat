import { useEffect, useRef } from "react";
import type { MeltOutcome } from "@/features/book/settle";
import { useSession } from "@/features/session/view";
import { usePurseOf } from "../view";
import { registerRecorder, theBook, walletCoins } from "./purseBridge";
import { useCashuHistory } from "./useCashuHistory";

/**
 * Settles what the signed-in account's operations left behind, and tries the
 * tokens kept while their mint did not answer: on start, when the tab comes
 * back, and every minute. Mount it once for the app; the recovery host already
 * keeps it to one pass per account across tabs. While mounted, the account's
 * purse writes activity through its wallet.
 */
export function useRecovery(
  onMeltSettled: (quoteId: string, outcome: MeltOutcome) => void
) {
  const { pubkey: owner } = useSession();
  const { createHistory } = useCashuHistory();
  const purseOf = usePurseOf();
  const report = useRef(onMeltSettled);
  useEffect(() => {
    report.current = onMeltSettled;
  });

  useEffect(() => {
    if (owner) return registerRecorder(owner, createHistory);
  }, [owner, createHistory]);
  useEffect(() => {
    if (!owner) return;
    const run = async () => {
      // into the wallet's own store, for this account whoever is active by then
      const outcomes = await theBook().recovery.settle(
        owner,
        (mintUrl) => (add, remove) =>
          walletCoins().change(owner, mintUrl, add, remove)
      );
      outcomes.forEach((outcome, quoteId) => report.current(quoteId, outcome));
      await purseOf(owner)?.retryPending();
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
  }, [owner, purseOf]);
}
