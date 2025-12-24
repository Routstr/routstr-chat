"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
} from "react";
import {
  useConversationState,
  UseConversationStateReturn,
} from "@/hooks/useConversationState";
import { useApiState, UseApiStateReturn } from "@/hooks/useApiState";
import { useUiState, UseUiStateReturn } from "@/hooks/useUiState";
import { useModelState, UseModelStateReturn } from "@/hooks/useModelState";
import { useChatActions, UseChatActionsReturn } from "@/hooks/useChatActions";
import { useCashuWithXYZ } from "@/hooks/useCashuWithXYZ";
import { useAuth } from "./AuthProvider";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNostrLogin } from "@nostrify/react/login";
import type { NostrEvent } from "nostr-tools";
import { userPubkey$, userSigner$ } from "@/hooks/useChatSync1081";

interface ChatContextType
  extends
    UseConversationStateReturn,
    UseApiStateReturn,
    UseUiStateReturn,
    UseModelStateReturn,
    UseChatActionsReturn,
    ReturnType<typeof useCashuWithXYZ> {
  // Additional computed properties or methods can be added here
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};

interface ChatProviderProps {
  children: React.ReactNode;
}

/**
 * Centralized chat state management provider
 * Consolidates chat state, action dispatchers, state persistence,
 * and cross-component communication
 */
export const ChatProvider: React.FC<ChatProviderProps> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const { user } = useCurrentUser();
  const { logins } = useNostrLogin();

  // Update pnsKeys$ and userSigner$ observables when user changes
  useEffect(() => {
    if (user?.pubkey && logins.length > 0) {
      userPubkey$.next(user?.pubkey);

      // Set the user signer for 1081 event decryption
      if (user.signer?.nip44 && typeof user.signer.signEvent === "function") {
        userSigner$.next({
          signer: user.signer as {
            nip44: {
              encrypt: (pubkey: string, plaintext: string) => Promise<string>;
              decrypt: (pubkey: string, content: string) => Promise<string>;
            };
            signEvent: (event: {
              kind: number;
              created_at: number;
              tags: string[][];
              content: string;
            }) => Promise<NostrEvent>;
          },
          pubkey: user.pubkey,
        });
      } else {
        userSigner$.next(null);
      }
    } else {
      userSigner$.next(null);
    }
  }, [user?.pubkey, user?.signer, logins]);

  const conversationState = useConversationState();
  const cashuWithXYZ = useCashuWithXYZ();
  const chatActions = useChatActions({
    createAndStoreChatEvent: conversationState.createAndStoreChatEvent,
    getLastNonSystemMessageEventId:
      conversationState.getLastNonSystemMessageEventId,
    updateLastMessageSatsSpent: conversationState.updateLastMessageSatsSpent,
  });
  const apiState = useApiState(
    isAuthenticated,
    cashuWithXYZ.balance,
    cashuWithXYZ.maxBalance,
    cashuWithXYZ.pendingCashuAmountState,
    cashuWithXYZ.isWalletLoading
  );
  const uiState = useUiState(isAuthenticated);
  const modelState = useModelState();

  const contextValue: ChatContextType = {
    ...conversationState,
    ...apiState,
    ...uiState,
    ...modelState,
    ...chatActions,
    ...cashuWithXYZ,
  };

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
};
