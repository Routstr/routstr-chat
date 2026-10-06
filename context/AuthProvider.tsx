"use client";

import React, { createContext, useContext } from "react";
import { useSession } from "@/features/session/view";

/* The old auth shape, now read from the session. Screens move to useSession()
   directly; the lab fills this context with a fake to draw signed-out views. */

interface AuthContextType {
  isAuthenticated: boolean;
  authChecked: boolean;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const { pubkey, ready, signOut } = useSession();
  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: pubkey !== null,
        authChecked: ready,
        logout: signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
