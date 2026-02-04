import { useState, useEffect, useCallback } from "react";
import { clearAllStorage } from "@/utils/storageUtils";
import { useAccountManager } from "@/components/ClientProviders";
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
  const { manager } = useAccountManager();
  const accounts = useObservableState(manager.accounts$) || [];
  const [authChecked, setAuthChecked] = useState(false);

  const isAuthenticated = accounts.length > 0;

  const logout = useCallback(async () => {
    // Logout from applesauce-accounts
    const activeAccount = manager.active$.value;
    if (activeAccount) {
      // @ts-ignore
      manager.removeAccount(activeAccount);
    }
    // Optionally remove all accounts if that's what logout should do
    // For now, just clearing active account and storage seems consistent with existing logic

    clearAllStorage();
  }, [manager]);

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
