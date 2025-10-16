'use client';

import React from 'react';
import { Menu, SquarePen } from 'lucide-react';
import { useChat } from '@/context/ChatProvider';
import { useAuth } from '@/context/AuthProvider';
import ModelSelector from './ModelSelector';
import { BalanceDisplay } from '@/features/wallet';

/**
 * Top header with model selector and controls
 * Handles model selector integration, balance display,
 * mobile menu button, and header layout and styling
 */
const ChatHeader: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const {
    // Model State
    selectedModel,
    baseUrl,
    isModelDrawerOpen,
    setIsModelDrawerOpen,
    isLoadingModels,
    models: filteredModels,
    handleModelChange,
    configuredModels,
    toggleConfiguredModel,
    setModelProviderFor,
    
    // UI State
    isMobile,
    isSidebarOpen,
    isSidebarCollapsed,
    setIsSidebarOpen,
    setIsLoginModalOpen,
    createNewConversationHandler,
    
    // Balance
    balance,

    // Settings
    setIsSettingsOpen,
    setInitialSettingsTab
  } = useChat();

  return (
    <div className={`fixed top-0 ${isMobile && isSidebarOpen ? 'bg-[#181818]' : 'bg-[#181818]'} backdrop-blur-sm z-30 transition-all duration-300 ease-in-out ${
      isMobile || !isAuthenticated
        ? 'left-0 right-0'
        : isSidebarCollapsed
          ? 'left-0 right-0'
          : 'left-72 right-0'
    }`}>
      <div className={`flex items-center justify-start h-[60px] relative ${
        isMobile ? 'px-2' : 'px-4'
      }`}>
        {/* Mobile Menu Button */}
        {isMobile && !isAuthenticated && (
          <button
            onClick={() => setIsLoginModalOpen(true)}
            className="absolute left-2 rounded-full p-1.5 shadow-md border border-white/10 bg-white/5 hover:bg-white/10 text-white cursor-pointer"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        {isMobile && isAuthenticated && (
          <div className="absolute left-2 flex gap-1.5">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="rounded-full p-1.5 shadow-md border border-white/10 bg-white/5 hover:bg-white/10 text-white cursor-pointer"
              aria-label="Open sidebar"
            >
              <Menu className="h-4 w-4" />
            </button>
            <button
              onClick={() => createNewConversationHandler()}
              className="rounded-full p-1.5 shadow-md border border-white/10 bg-white/5 hover:bg-white/10 text-white cursor-pointer"
              aria-label="New chat"
            >
              <SquarePen className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Desktop New Chat (only when sidebar is collapsed) */}
        {!isMobile && isAuthenticated && isSidebarCollapsed && (
          <button
            onClick={() => createNewConversationHandler()}
            className="absolute left-12 rounded-full p-1.5 shadow-md border border-white/10 bg-white/5 hover:bg-white/10 text-white cursor-pointer"
            aria-label="New chat"
          >
            <SquarePen className="h-4 w-4" />
          </button>
        )}

        {/* Model Selector - left aligned; add padding on mobile and when sidebar is collapsed to avoid overlap */}
        <div className={`${isMobile ? 'pl-20' : (isAuthenticated && isSidebarCollapsed ? 'pl-20' : '')}`}>
          <ModelSelector
            selectedModel={selectedModel}
            isModelDrawerOpen={isModelDrawerOpen}
            setIsModelDrawerOpen={setIsModelDrawerOpen}
            isAuthenticated={isAuthenticated}
            setIsLoginModalOpen={setIsLoginModalOpen}
            isLoadingModels={isLoadingModels}
            filteredModels={filteredModels}
            handleModelChange={handleModelChange}
            balance={balance}
            configuredModels={configuredModels}
            toggleConfiguredModel={toggleConfiguredModel}
            setModelProviderFor={setModelProviderFor}
            baseUrl={baseUrl}
            openModelsConfig={() => {
              setIsSettingsOpen(true);
              setInitialSettingsTab('models');
            }}
          />
        </div>

        {/* Balance Display */}
        <div className={`absolute ${
          isMobile ? 'right-2' : 'right-4'
        }`}>
          <BalanceDisplay
            setIsSettingsOpen={setIsSettingsOpen}
            setInitialSettingsTab={setInitialSettingsTab}
          />
        </div>
      </div>
    </div>
  );
};

export default ChatHeader;