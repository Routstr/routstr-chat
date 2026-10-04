import { useCallback } from "react";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import { useAccountManager, type AccountMetadata } from "@/components/ClientProviders";
import { markEphemeralNsecCreated } from "@/utils/storageUtils";

/** No account needed to start: the first time money arrives, a key is made on
 *  this device (the same thing the old top-up did). Does nothing if one exists. */
export function useEnsureAccount() {
  const { manager, manualSave } = useAccountManager();
  return useCallback(() => {
    if (manager.accounts$.value.length > 0) return false;
    const account = PrivateKeyAccount.generateNew<AccountMetadata>();
    manager.addAccount(account);
    manager.setActive(account);
    manualSave.next();
    markEphemeralNsecCreated();
    return true;
  }, [manager, manualSave]);
}
