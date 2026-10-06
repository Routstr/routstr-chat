import { useCallback } from "react";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import { useAccountManager } from "@/components/ClientProviders";
import type { AccountMetadata } from "@/features/session/service";
import { markEphemeralNsecCreated } from "@/utils/storageUtils";

/** No account needed to start: the first time money arrives, a key is made on
 *  this device (the same thing the old top-up did). Does nothing if one exists. */
export function useEnsureAccount() {
  const { manager, session } = useAccountManager();
  return useCallback(() => {
    if (manager.accounts$.value.length > 0) return false;
    session.add(PrivateKeyAccount.generateNew<AccountMetadata>());
    markEphemeralNsecCreated();
    return true;
  }, [manager, session]);
}
