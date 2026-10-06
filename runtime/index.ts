import { SessionService } from "@/features/session/service";

/* The composition root: built once per tab, before the first render. */

export const session = new SessionService();

if (typeof window !== "undefined") session.boot(window.localStorage);
