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
interface ChatContainerProps {
  onShowQRCode: (data: { invoice: string; amount: string; unit: string }) => void;
  isQrModalOpen: boolean;
}

const ChatContainer: React.FC<ChatContainerProps> = ({ onShowQRCode, isQrModalOpen }) => {
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
    
    // Balance
    balance,

    // Sync
    syncWithNostr,
    isSyncing
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
          syncWithNostr={syncWithNostr}
          isSyncing={isSyncing}
        />
      )}

      {/* Main Chat Area */}
      <div className={`${!isMobile && isAuthenticated && !isSidebarCollapsed ? 'ml-72' : 'ml-0'} flex-1 flex flex-col h-full overflow-hidden relative transition-[margin] duration-300 ease-in-out`}>
        {/* Fixed Header */}
        <ChatHeader onShowQRCode={onShowQRCode} isQrModalOpen={isQrModalOpen} />

        {/* Main Chat Content */}
        <MainChatArea />
      </div>
    </div>
  );
};

export default ChatContainer;