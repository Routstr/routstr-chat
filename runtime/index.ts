import { SessionService } from "@/features/session/service";
import { bindOwner } from "./owner";

/* The composition root: built once per tab, before the first render. */

export const session = new SessionService();

if (typeof window !== "undefined") {
  session.boot(window.localStorage);
  // the first listener, so stores follow the owner before anything reads them
  const bind = () =>
    bindOwner(session.getSnapshot().pubkey, window.localStorage);
  bind();
  session.subscribe(bind);
}
