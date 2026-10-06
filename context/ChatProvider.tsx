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
import { useBlossomSync } from "@/hooks/useBlossomSync";
import { useHistoryKeys } from "@/features/history/view";
import { useAuth } from "./AuthProvider";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import type { NostrEvent } from "nostr-tools";
import { userPubkey$, userSigner$ } from "@/hooks/sync/chatSyncInputs";
import { blobToDataUrl } from "@/utils/messageUtils";

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

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

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
  const { manager } = useAccountManager();
  const accounts = useObservableState(manager.accounts$) || [];
  const activeAccount = useObservableState(manager.active$);

  // Update userPubkey$ and userSigner$ observables when user changes
  useEffect(() => {
    const accountToUse = activeAccount || accounts[0];

    if (!accountToUse) {
      userPubkey$.next(null);
      userSigner$.next(null);
      return;
    }

    const pubkey = accountToUse.pubkey;
    userPubkey$.next(pubkey);

    // Set the user signer for the old config sync (kind 30078) from the applesauce account
    const signer = accountToUse.signer;
    if (signer?.nip44 && typeof signer.signEvent === "function") {
      userSigner$.next({
        signer: signer as {
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
        pubkey: pubkey,
      });
    } else {
      userSigner$.next(null);
    }
  }, [accounts, activeAccount]);

  const conversationState = useConversationState();
  const cashuWithXYZ = useCashuWithXYZ();

  // Blossom sync for AI-generated images
  const { uploadToBlossomAsync, fetchFromBlossom, blossomSyncEnabled } =
    useBlossomSync();
  const pnsKeys = useHistoryKeys();

  // Create a stable callback for uploading generated images to Blossom
  const handleBlossomUpload = useCallback(
    async (file: File): Promise<{ hash: string; servers: string[] } | null> => {
      if (blossomSyncEnabled && pnsKeys) {
        try {
          return await uploadToBlossomAsync(file, pnsKeys);
        } catch {
          return null;
        }
      }
      return null;
    },
    [blossomSyncEnabled, pnsKeys, uploadToBlossomAsync]
  );

  // Resolves a Blossom hash to a data URL for API resends (cross-device images)
  const handleBlossomFetch = useCallback(
    async (hash: string, servers?: string[]): Promise<string | null> => {
      if (!blossomSyncEnabled || !pnsKeys) return null;
      try {
        const result = await fetchFromBlossom(hash, pnsKeys, servers);
        if (!result) return null;
        const blob = new Blob([result.data as BlobPart], {
          type: result.mimeType,
        });
        return await blobToDataUrl(blob);
      } catch {
        return null;
      }
    },
    [blossomSyncEnabled, pnsKeys, fetchFromBlossom]
  );

  const chatActions = useChatActions({
    createAndStoreChatEvent: conversationState.createAndStoreChatEvent,
    getLastNonSystemMessageEventId:
      conversationState.getLastNonSystemMessageEventId,
    updateLastMessageSatsSpent: conversationState.updateLastMessageSatsSpent,
    onBlossomUpload: handleBlossomUpload,
    onBlossomFetch: handleBlossomFetch,
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
