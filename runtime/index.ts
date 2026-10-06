import { SessionService, type Switcher } from "@/features/session/service";
import { savedInIndexedDB } from "@/features/session/saved";
import { bindOwner } from "./owner";
import { bindHistory, relays } from "./nostr";
import { startKeys } from "./keys";
import { bindBook } from "./book";
import { node } from "./node";
import { createRouting } from "./routing";
import { startChat, activeChat } from "./accountChat";

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
  // The one switch path: the account's chat stops first, so a reply still
  // being saved or paid finishes in its own account (and settle runs even if
  // that fails); history, keys and chat then follow the session.
  const switchAccount: Switcher = () => {
    const chat = activeChat.get()?.chat;
    // nothing running: at once, so a screen that signs in can act right after
    if (!chat || (!chat.busy() && chat.answering() === null)) session.settle();
    else void chat.stopAll().finally(() => session.settle());
  };
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

  // the models providers serve: the last visit's at once, then fresh ones
  routing.catalog.start();

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
    const started = account
      ? startKeys(account, relays.of(account.pubkey))
      : null;
    keys = started;
    startChat(account?.pubkey ?? null, routing.payments, started?.otherDevices);
  };
  follow();
  session.subscribe(follow);
}
