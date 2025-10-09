'use client';

import React from 'react';
import { Menu, SquarePen } from 'lucide-react';
import { useChat } from '@/context/ChatProvider';
import { useAuth } from '@/context/AuthProvider';
import ModelSelector from './ModelSelector';
import BalanceDisplay from '../ui/BalanceDisplay';

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
    isModelDrawerOpen,
    setIsModelDrawerOpen,
    isLoadingModels,
    models: filteredModels,
    handleModelChange,
    configuredModels,
    toggleConfiguredModel,
    
    // UI State
    isMobile,
    isSidebarCollapsed,
    setIsSidebarOpen,
    setIsLoginModalOpen,
    createNewConversationHandler,
    
    // Balance
    balance,
    usingNip60,

    // Settings
    setIsSettingsOpen,
    setInitialSettingsTab
  } = useChat();

  return (
    <div className={`fixed top-0 bg-black/95 backdrop-blur-sm z-40 transition-all duration-300 ease-in-out ${
      isMobile || !isAuthenticated ? 'left-0 right-0' : isSidebarCollapsed ? 'left-0 right-0' : 'left-72 right-0'
    }`}>
      <div className={`flex items-center justify-center h-[60px] relative ${
        isMobile ? 'px-2' : 'px-4'
      }`}>
        {/* Mobile Menu Button */}
        {isMobile && !isAuthenticated && (
          <button
            onClick={() => setIsLoginModalOpen(true)}
            className="absolute left-2 bg-black rounded-full p-1.5 shadow-md border border-white/10 hover:bg-white/5 cursor-pointer"
          >
            <Menu className="h-4 w-4 text-white" />
          </button>
        )}
        {isMobile && isAuthenticated && (
          <div className="absolute left-2 flex gap-1.5">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="bg-black rounded-full p-1.5 shadow-md border border-white/10 hover:bg-white/5 cursor-pointer"
              aria-label="Open sidebar"
            >
              <Menu className="h-4 w-4 text-white" />
            </button>
            <button
              onClick={() => createNewConversationHandler()}
              className="bg-black rounded-full p-1.5 shadow-md border border-white/10 hover:bg-white/5 cursor-pointer"
              aria-label="New chat"
            >
              <SquarePen className="h-4 w-4 text-white" />
            </button>
          </div>
        )}

        {/* Model Selector */}
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
          openModelsConfig={() => {
            setIsSettingsOpen(true);
            setInitialSettingsTab('models');
          }}
        />

        {/* Balance Display */}
        <div className={`absolute ${
          isMobile ? 'right-2' : 'right-4'
        }`}>
          <BalanceDisplay
            setIsSettingsOpen={setIsSettingsOpen}
            setInitialSettingsTab={setInitialSettingsTab}
            usingNip60={usingNip60}
          />
        </div>
      </div>
    </div>
  );
};

export default ChatHeader;