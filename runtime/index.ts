import { SessionService } from "@/features/session/service";
import { savedInIndexedDB } from "@/features/session/saved";
import { bindOwner } from "./owner";
import { relays } from "./nostr";
import { startKeys } from "./keys";

/* The composition root: built once per tab, before the first render. */

export const session = new SessionService();

if (typeof window !== "undefined") {
  session.boot(window.localStorage, savedInIndexedDB());
  // another tab added or removed an account, or a main tab from before the
  // update cleared localStorage when someone signed out there
  window.addEventListener("storage", (event) => {
    const wiped = event.key === "activeAccount" && !event.newValue;
    if (event.key === null || event.key === "accounts" || wiped) {
      session.refresh();
    }
  });
  // the first listener, so stores follow the owner before anything reads them
  const bind = () =>
    bindOwner(session.getSnapshot().pubkey, window.localStorage);
  bind();
  session.subscribe(bind);

  let keys: { stop(): void } | null = null;
  const follow = () => {
    keys?.stop();
    const account = session.accounts.active$.value;
    keys = account ? startKeys(account, relays.of(account.pubkey)) : null;
  };
  follow();
  session.subscribe(follow);
}
