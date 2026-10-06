import { SessionService, type Switcher } from "@/features/session/service";
import { savedInIndexedDB } from "@/features/session/saved";
import { bindOwner } from "./owner";
import { bindHistory, relays } from "./nostr";
import { startKeys } from "./keys";
import { bindBook } from "./book";
import { node } from "./node";
import { createRouting } from "./routing";

/* The composition root: built once per tab, before the first render. */

export const session = new SessionService();

// node mode: the node pays only for the account its key was issued to
const payingNode = () => node.paysFor(session.getSnapshot().pubkey)?.url;

/** Providers, models and the SDK's routing, once per tab. */
export const routing = createRouting({
  node: payingNode,
  // a local test stack's provider, given at build time
  extraProviders: (process.env.NEXT_PUBLIC_ROUTSTR_PROVIDERS ?? "").split(",").filter(Boolean),
});

if (typeof window !== "undefined") {
  // The one switch path. The account's chat will stop here first, once the
  // chat engine is built here (and settle runs even if that fails); history
  // and keys follow the session after it.
  const switchAccount: Switcher = () => session.settle();
  session.boot(window.localStorage, savedInIndexedDB(), switchAccount);
  // another tab added or removed an account, or a main tab from before the
  // update cleared localStorage when someone signed out there
  window.addEventListener("storage", (event) => {
    const wiped = event.key === "activeAccount" && !event.newValue;
    if (event.key === null || event.key === "accounts" || wiped) {
      session.refresh();
    }
  });
  // the first listener, so stores follow the owner before anything reads them
  const bind = () => {
    const { pubkey } = session.getSnapshot();
    bindOwner(pubkey, window.localStorage);
    bindBook(pubkey);
    bindHistory(session.accounts.active$.value);
  };
  bind();
  session.subscribe(bind);

  // node mode turned on or off, or another account in use: the models follow
  let paying = payingNode();
  const followNode = () => {
    const now = payingNode();
    if (now === paying) return;
    paying = now;
    void routing.catalog.refresh();
  };
  node.subscribe(followNode);
  session.subscribe(followNode);

  let keys: { stop(): void } | null = null;
  const follow = () => {
    keys?.stop();
    const account = session.accounts.active$.value;
    keys = account ? startKeys(account, relays.of(account.pubkey)) : null;
  };
  follow();
  session.subscribe(follow);
}
