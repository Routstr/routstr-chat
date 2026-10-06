import { SessionService } from "@/features/session/service";
import { savedInIndexedDB } from "@/features/session/saved";
import { bindOwner } from "./owner";

/* The composition root: built once per tab, before the first render. */

export const session = new SessionService();

if (typeof window !== "undefined") {
  session.boot(window.localStorage, savedInIndexedDB());
  // a main tab from before the update cleared localStorage when someone
  // signed out there: the accounts go back into it from this tab
  window.addEventListener("storage", (event) => {
    if (event.key === null || (event.key === "accounts" && !event.newValue)) {
      session.repair();
    }
  });
  // the first listener, so stores follow the owner before anything reads them
  const bind = () =>
    bindOwner(session.getSnapshot().pubkey, window.localStorage);
  bind();
  session.subscribe(bind);
}
