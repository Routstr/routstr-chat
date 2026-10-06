import { useState, useEffect, useCallback } from "react";
import { useAccountManager } from "@/components/ClientProviders";
import { leaveDeviceWallet } from "@/hooks/useBitcoinConnect";
import { useObservableState } from "applesauce-react/hooks";

export interface UseAuthStateReturn {
  isAuthenticated: boolean;
  authChecked: boolean;
  logout: () => Promise<void>;
}

/**
 * Custom hook for managing authentication state
 * Handles authentication status tracking, login/logout operations,
 * user session persistence, and authentication checks
 */
export const useAuthState = (): UseAuthStateReturn => {
  const { manager, session } = useAccountManager();
  const accounts = useObservableState(manager.accounts$) || [];
  const [authChecked, setAuthChecked] = useState(false);

  const isAuthenticated = accounts.length > 0;

  /** Signs the active account out. Nothing it owns is deleted: its coins,
   *  tokens and unfinished payments stay under its own name on this device
   *  and come back when it signs in again. The next account takes over, and
   *  nobody after this one may pay from this device's Lightning wallet. */
  const logout = useCallback(async () => {
    const activeAccount = manager.active$.value;
    if (activeAccount) session.remove(activeAccount.id);
    await leaveDeviceWallet();
  }, [manager, session]);

  // Set authChecked to true on initial render
  useEffect(() => {
    setAuthChecked(true);
  }, []);

  return {
    isAuthenticated,
    authChecked,
    logout,
  };
};
