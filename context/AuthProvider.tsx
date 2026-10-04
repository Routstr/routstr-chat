"use client";

import React, { createContext, useContext } from "react";
import { useAuthState, UseAuthStateReturn } from "@/hooks/useAuthState";

interface AuthContextType extends UseAuthStateReturn {}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Authentication context provider
 * Provides user authentication state, login/logout actions,
 * session management, and authentication persistence
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const authState = useAuthState();

  return (
    <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>
  );
};
