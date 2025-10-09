'use client';

import React from 'react';
import { Menu } from 'lucide-react';
import { useChat } from '@/context/ChatProvider';
import { useAuth } from '@/context/AuthProvider';
import ChatHeader from './ChatHeader';
import MainChatArea from './MainChatArea';
import Sidebar from './Sidebar';

/**
 * Main layout container and orchestration component
 * Handles overall layout structure, responsive design logic,
 * component composition, and event handling coordination
 */
const ChatContainer: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const {
    // UI State
    isSidebarOpen,
    setIsSidebarOpen,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isMobile,
    setIsSettingsOpen,
    setInitialSettingsTab,
    
    // Conversation State
    conversations,
    activeConversationId,
    createNewConversationHandler,
    loadConversation,
    deleteConversation,
    isLoadingConversations,
    isSyncingConversations,
    cloudSyncEnabled,
    syncConflicts,
    refetchConversations,
    lastSyncTime,
    
    // Balance
    balance
  } = useChat();

  return (
    <div className={`flex h-dvh w-full ${isMobile && isSidebarOpen ? 'bg-[#181818]' : 'bg-[#181818]'} text-white overflow-hidden`}>
      {/* Mobile Sidebar Overlay */}
      {isMobile && isAuthenticated && (
        <div
          className={`fixed inset-0 bg-black/70 z-40 transition-opacity duration-300 ${
            isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar - only render when authenticated */}
      {isAuthenticated && (
        <Sidebar
          isAuthenticated={isAuthenticated}
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          isSidebarCollapsed={isSidebarCollapsed}
          setIsSidebarCollapsed={setIsSidebarCollapsed}
          isMobile={isMobile}
          conversations={conversations}
          activeConversationId={activeConversationId}
          createNewConversation={createNewConversationHandler}
          loadConversation={loadConversation}
          deleteConversation={deleteConversation}
          setIsSettingsOpen={setIsSettingsOpen}
          setInitialSettingsTab={setInitialSettingsTab}
          balance={balance}
          isLoadingConversations={isLoadingConversations}
          isSyncingConversations={isSyncingConversations}
          cloudSyncEnabled={cloudSyncEnabled}
          syncConflicts={syncConflicts}
          refetchConversations={refetchConversations}
          lastSyncTime={lastSyncTime}
        />
      )}

      {/* Main Chat Area */}
      <div className={`${!isMobile && isAuthenticated && !isSidebarCollapsed ? 'ml-72' : 'ml-0'} flex-1 flex flex-col h-full overflow-hidden relative transition-[margin] duration-300 ease-in-out`}>
        {/* Fixed Header */}
        <ChatHeader />

        {/* Main Chat Content */}
        <MainChatArea />
      </div>
    </div>
  );
};

export default ChatContainer;