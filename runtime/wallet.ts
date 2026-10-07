import type { Account } from "@/features/session/service";
import {
  legacyActivity,
  listMint,
  localActivity,
  registerCoins,
  setWalletCopy,
  setWalletLoading,
} from "@/features/wallet/hooks/purseBridge";
import { MintKeysets } from "@/features/wallet/mints";
import type {
  ActivityLog,
  CoinStore,
  WalletSigner,
} from "@/features/wallet/ports";
import { createPurse, type Purse } from "@/features/wallet/purse";
import { Replica } from "@/features/wallet/replica";
import { useWalletStore } from "@/features/wallet/state/walletStore";
import { oldCoins, sweep } from "@/features/wallet/sweep";
import { IndexedCoins } from "@/platform/wallet/coins";
import { isMains, journal, locks } from "./book";
import { relays } from "./nostr";

/* The one door to each account's money. A chat's per-reply payments and
   refunds keep their activity on this device (a reply never asks the
   signer); what the person does with a button (the wallet screens, API keys)
   is published. Both kinds move coins through the same book and lock. Coins
   live in IndexedDB, and each account's copy on relays (NIP-60) follows it. */

const browser = typeof window !== "undefined";
const keysets = new MintKeysets();
let opened: IndexedCoins | null = null;
const indexed = () =>
  (opened ??= IndexedCoins.open((mintUrl, id) => keysets.unitOf(mintUrl, id)));

const coins: CoinStore = {
  async change(owner, mintUrl, add, remove) {
    // the old store's list still names the wallet's mints (Settings, the active one)
    await listMint(useWalletStore.of(owner).getState(), mintUrl, add);
    await indexed().change(owner, mintUrl, add, remove);
  },
  coins: (owner, mintUrl) => indexed().coins(owner, mintUrl),
  activeMint: (owner) =>
    useWalletStore.of(owner).getState().activeMintUrl ?? "",
  subscribe: (_, listener) => indexed().subscribe(listener),
};
if (browser) registerCoins(coins);

const made = new Map<ActivityLog, Map<string, Purse>>();

function cached(owner: string, activity: ActivityLog): Purse {
  const purses = made.get(activity) ?? new Map<string, Purse>();
  made.set(activity, purses);
  let purse = purses.get(owner);
  if (!purse) {
    purse = createPurse(owner, {
      coins,
      activity,
      journal,
      locks,
    });
    purses.set(owner, purse);
  }
  return purse;
}

/** The purse a chat pays replies from: of `owner`, never of whoever is
 *  active when it is used. */
export const purseFor = (owner: string): Purse => cached(owner, localActivity);

/** The purse of `owner` for the person's own moves: activity published. */
export const walletPurseFor = (owner: string): Purse =>
  cached(owner, legacyActivity);

const signerOf = (account: Account): WalletSigner => {
  const nip44 = () => {
    if (!account.nip44) throw new Error("Your signer cannot encrypt (NIP-44)");
    return account.nip44;
  };
  return {
    encrypt: (text) => nip44().encrypt(account.pubkey, text),
    decrypt: (text) => nip44().decrypt(account.pubkey, text),
    sign: (template) => account.signEvent(template),
  };
};

const PUSH_AFTER_MS = 1000;
const PULL_AFTER_MS = 2000;
// a push that failed is tried again later and later (each try may ask the
// signer): from a minute up to half an hour, and at once when back online
const RETRY_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;

let bound: { account: Account; stop(): void } | null = null;

/**
 * Called by the composition root when the active account changes. Main's old
 * coin list for the account is swept in, its copy on relays is read, and from
 * then on every change of its coins is published (tried again later while any
 * is left in the outbox, and when the network is back), and what another
 * device publishes is read as it arrives. Another account's outbox waits in
 * IndexedDB until that account is active again: it is never published under
 * this one's signer.
 */
export function bindWallet(account: Account | undefined): void {
  // the account, not its key: one key can be in twice (an extension and an
  // nsec), and each copy signs with its own signer
  if (bound?.account === account) return;
  bound?.stop();
  bound = null;
  if (!browser || !account || !locks) return;
  const owner = account.pubkey;
  const store = indexed();
  const replica = new Replica(owner, {
    store,
    signer: signerOf(account),
    relays: relays.of(owner),
    locks,
  });
  const storage = window.localStorage;
  const old = [`cashu:${owner}`, ...(isMains(owner) ? ["cashu"] : [])];
  // every key's old list on this device, so another key's money counts
  // before it is active again (its outbox waits for it)
  const others = () =>
    Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? "")
      .map((key) => /^cashu:([0-9a-f]{64})$/.exec(key)?.[1])
      .filter((pubkey): pubkey is string => !!pubkey && pubkey !== owner);
  const sweepOld = () =>
    Promise.all([
      ...old.map((key) =>
        sweep(owner, oldCoins(storage.getItem(key)), { into: store, locks })
      ),
      ...others().map((pubkey) =>
        sweep(pubkey, oldCoins(storage.getItem(`cashu:${pubkey}`)), {
          into: store,
          locks,
        })
      ),
    ]);
  let retrying: ReturnType<typeof setTimeout> | undefined;
  let wait = RETRY_MS;
  let stopped = false;
  const push = async () => {
    clearTimeout(retrying);
    if (stopped) return;
    const done = await replica.push().catch((error) => {
      console.error("Could not publish the coins:", error);
      return false;
    });
    if (stopped) return;
    if (done) {
      wait = RETRY_MS;
    } else {
      // a push that overlapped this one may have set one already
      clearTimeout(retrying);
      retrying = setTimeout(push, wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    }
  };
  const pull = () =>
    replica
      .pull()
      .then(({ answered, outcomes }) => {
        if (!stopped) {
          setWalletCopy(
            owner,
            answered.length ? "read" : "unanswered",
            outcomes
          );
        }
      })
      .catch((error) => console.error("Could not read the coins:", error));

  setWalletLoading(owner, true);
  setWalletCopy(owner, "reading");
  // every mint that holds a coin is in the wallet's list, the coins from
  // relays and old lists too, so the screens name it and count it
  const listMints = async () => {
    const mints = useWalletStore.of(owner).getState();
    const holding = new Set((await store.coins(owner)).map((c) => c.mintUrl));
    for (const url of holding) {
      if (!mints.mints.some((m) => m.url === url)) await listMint(mints, url);
    }
  };

  // a switch while the old lists are swept: nothing more runs for this one
  void sweepOld()
    .then(() => (stopped ? undefined : pull()))
    .then(() => (stopped ? undefined : listMints()))
    .finally(() => {
      if (stopped) return;
      setWalletLoading(owner, false);
      void push();
    });

  let pushing: ReturnType<typeof setTimeout> | undefined;
  let pulling: ReturnType<typeof setTimeout> | undefined;
  const offStore = store.subscribe(() => {
    clearTimeout(pushing);
    pushing = setTimeout(() => {
      void listMints();
      void push();
    }, PUSH_AFTER_MS);
  });
  const live = relays
    .of(owner)
    .live({ kinds: [7375, 5], authors: [owner] })
    .subscribe(() => {
      clearTimeout(pulling);
      pulling = setTimeout(pull, PULL_AFTER_MS);
    });
  const online = () => {
    wait = RETRY_MS;
    void push();
  };
  const oldChanged = (event: StorageEvent) => {
    if (event.key && old.includes(event.key)) void sweepOld();
  };
  window.addEventListener("online", online);
  window.addEventListener("storage", oldChanged);
  bound = {
    account,
    stop() {
      stopped = true;
      offStore();
      live.unsubscribe();
      clearTimeout(pushing);
      clearTimeout(pulling);
      clearTimeout(retrying);
      window.removeEventListener("online", online);
      window.removeEventListener("storage", oldChanged);
    },
  };
}
