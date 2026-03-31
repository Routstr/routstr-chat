import { useState, useEffect, useCallback } from "react";
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
  const { manager, signOutActive } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);
  const [authChecked, setAuthChecked] = useState(false);

  const isAuthenticated = !!activeAccount;

  const logout = useCallback(async () => {
    await signOutActive();
  }, [signOutActive]);

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
