'use client';

import React, { createContext, useContext } from 'react';
import { useConversationState, UseConversationStateReturn } from '@/hooks/useConversationState';
import { useApiState, UseApiStateReturn } from '@/hooks/useApiState';
import { useUiState, UseUiStateReturn } from '@/hooks/useUiState';
import { useModelState, UseModelStateReturn } from '@/hooks/useModelState';
import { useChatActions, UseChatActionsReturn } from '@/hooks/useChatActions';
import { useCashuWithXYZ } from '@/hooks/useCashuWithXYZ';
import { useAuth } from './AuthProvider';

interface ChatContextType extends 
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
    throw new Error('useChat must be used within a ChatProvider');
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
  
  const conversationState = useConversationState();
  const cashuWithXYZ = useCashuWithXYZ();
  const chatActions = useChatActions(); // Move chatActions declaration before apiState
  const apiState = useApiState(isAuthenticated, cashuWithXYZ.balance, cashuWithXYZ.maxBalance, cashuWithXYZ.pendingCashuAmountState, cashuWithXYZ.isWalletLoading);
  const uiState = useUiState(isAuthenticated);
  const modelState = useModelState();

  const contextValue: ChatContextType = {
    ...conversationState,
    ...apiState,
    ...uiState,
    ...modelState,
    ...chatActions,
    ...cashuWithXYZ
  };

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  );
};