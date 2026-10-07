import { Journal, memoryStorage, PREFIX } from "@/features/book/journal";
import { adoptLegacy } from "@/features/book/legacy";
import { RecoveryHost } from "@/features/book/recovery";
import { tokensOf, waitingOf } from "@/features/book/tokens";
import { currentOwner } from "@/features/session/owned";
import { legacyActivity } from "@/features/wallet/hooks/purseBridge";
import { toSats } from "@/features/wallet/purse";
import { useUnclaimedTokensStore } from "@/features/wallet/state/unclaimedTokensStore";

/* The wallet book for this tab: one journal for every account's money in motion. */

const storage =
  typeof window === "undefined" ? memoryStorage() : window.localStorage;

export const journal = new Journal(storage);

/** Keeps one operation per account at a time, across this browser's tabs. */
export const locks = globalThis.navigator?.locks;

export const recovery = new RecoveryHost({
  journal,
  locks,
  // a deposit recovery claimed is in the account's activity like any other
  claimed: (owner, proofs, unit) =>
    legacyActivity.record(owner, {
      direction: "in",
      sats: toSats(
        proofs.reduce((sum, p) => sum + p.amount, 0),
        unit
      ),
    }),
});

const showTokens = () => {
  const owner = currentOwner();
  const records = owner ? journal.list(owner) : [];
  useUnclaimedTokensStore.setState({
    unclaimedTokens: tokensOf(records),
    waitingTokens: waitingOf(records),
  });
};

// Main's own journal entries carry no owner. They are the account main had
// signed in, which is the first account v2 started with on this device (the
// two share the session's keys). That account is kept under a name main's
// sign-out wipe leaves alone, and only it ever takes those entries.
const MAIN_OWNER = "cashu_op:main-owner";

/** The account main had signed in: the plain old keys are its. */
export const isMains = (pubkey: string): boolean =>
  storage.getItem(MAIN_OWNER) === pubkey;

/** Runs when the active account changes: what main left behind becomes this
 *  account's, and the screens list this account's unclaimed tokens. */
export function bindBook(pubkey: string | null): void {
  if (pubkey) {
    try {
      if (storage.getItem(MAIN_OWNER) === null) {
        storage.setItem(MAIN_OWNER, pubkey);
      }
      const mains = storage.getItem(MAIN_OWNER) === pubkey;
      adoptLegacy(pubkey, storage, journal, mains);
    } catch (error) {
      // the old keys stay where they are and are tried again next time
      console.error("Could not move the old wallet data yet:", error);
    }
  }
  showTokens();
}

if (typeof window !== "undefined") {
  journal.subscribe(showTokens);
  // another tab wrote to the journal
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(PREFIX)) journal.changed();
  });
}
