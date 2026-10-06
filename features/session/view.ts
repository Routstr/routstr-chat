import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import { leaveDeviceWallet } from "@/hooks/useBitcoinConnect";
import type { Accounts, Session, SessionService } from "./service";

export type { Account, AccountMetadata } from "./service";

export { fromBunkerLink, readSecret, secretOf, signerByCode } from "./signIn";

/** The session the composition root built, for the screens. */
export const AccountContext = createContext<{
  manager: Accounts;
  session: SessionService;
} | null>(null);

export function useAccountManager() {
  const context = useContext(AccountContext);
  if (!context) throw new Error("useAccountManager needs ClientProviders");
  return context;
}

// what the server render and the hydration pass see: nobody is known yet
const BEFORE_BOOT: Session = { accountId: null, pubkey: null, generation: 0 };

/** Who is signed in. `ready` is false only while the page hydrates. */
export function useSession() {
  const { session } = useAccountManager();
  const now = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    () => BEFORE_BOOT
  );
  /** Nothing the account owns is deleted: it all comes back on its next
   *  sign-in. The next account on this device takes over, and nobody after
   *  this one may pay from this device's Lightning wallet. */
  const signOut = useCallback(async () => {
    if (now.accountId) session.remove(now.accountId);
    await leaveDeviceWallet();
  }, [now.accountId, session]);
  return { ...now, ready: now !== BEFORE_BOOT, signOut };
}
