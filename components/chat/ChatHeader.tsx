"use client";

import React from "react";
import { Menu, SquarePen } from "lucide-react";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import ModelSelector from "./ModelSelector";
import { BalanceDisplay } from "@/features/wallet";

/**
 * Top header with model selector and controls
 * Handles model selector integration, balance display,
 * mobile menu button, and header layout and styling
 */
interface ChatHeaderProps {
  onShowQRCode: (data: {
    invoice: string;
    amount: string;
    unit: string;
  }) => void;
  isQrModalOpen: boolean;
}

const headerIconButtonClassName =
  "rounded-full p-1.5 border border-border bg-muted/50 hover:bg-muted text-foreground cursor-pointer";

const HeaderIconButton: React.FC<{
  onClick: () => void;
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}> = ({ onClick, ariaLabel, className = "", children }) => (
  <button
    onClick={onClick}
    className={`${headerIconButtonClassName} ${className}`.trim()}
    aria-label={ariaLabel}
  >
    {children}
  </button>
);

const ChatHeader: React.FC<ChatHeaderProps> = ({
  onShowQRCode,
  isQrModalOpen,
}) => {
  const { isAuthenticated } = useAuth();
  const {
    // Model State
    selectedModel,
    baseUrl,
    isModelDrawerOpen,
    setIsModelDrawerOpen,
    isWalletLoading,
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
    startNewConversation,

    // Balance
    balance,

    // API State
    lowBalanceWarningForModel,

    // Settings
    setIsSettingsOpen,
    setInitialSettingsTab,
  } = useChat();

  return (
    <div
      className={`fixed top-0 bg-background backdrop-blur-sm z-30 transition-all duration-300 ease-in-out ${
        isMobile || !isAuthenticated
          ? "left-0 right-0"
          : isSidebarCollapsed
            ? "left-0 right-0"
            : "left-72 right-0"
      }`}
    >
      <div
        className={`flex items-center justify-start h-[60px] relative ${
          isMobile ? "px-2" : "px-4"
        }`}
      >
        {/* Mobile Menu Button */}
        {isMobile && !isAuthenticated && (
          <HeaderIconButton
            onClick={() => setIsLoginModalOpen(true)}
            className="absolute left-2"
            ariaLabel="Open login"
          >
            <Menu className="h-4 w-4" />
          </HeaderIconButton>
        )}
        {isMobile && isAuthenticated && (
          <div className="absolute left-2 flex gap-1.5">
            <HeaderIconButton
              onClick={() => setIsSidebarOpen(true)}
              ariaLabel="Open sidebar"
            >
              <Menu className="h-4 w-4" />
            </HeaderIconButton>
            <HeaderIconButton
              onClick={() => startNewConversation()}
              ariaLabel="New chat"
            >
              <SquarePen className="h-4 w-4" />
            </HeaderIconButton>
          </div>
        )}

        {/* Desktop New Chat (only when sidebar is collapsed) */}
        {!isMobile && isAuthenticated && isSidebarCollapsed && (
          <HeaderIconButton
            onClick={() => startNewConversation()}
            className="absolute left-12"
            ariaLabel="New chat"
          >
            <SquarePen className="h-4 w-4" />
          </HeaderIconButton>
        )}

        {/* Model Selector - left aligned; add padding on mobile and when sidebar is collapsed to avoid overlap */}
        <div
          className={`${
            isMobile
              ? "pl-20"
              : isAuthenticated && isSidebarCollapsed
                ? "pl-20"
                : ""
          }`}
        >
          <ModelSelector
            selectedModel={selectedModel}
            isModelDrawerOpen={isModelDrawerOpen}
            setIsModelDrawerOpen={setIsModelDrawerOpen}
            isAuthenticated={isAuthenticated}
            setIsLoginModalOpen={setIsLoginModalOpen}
            isWalletLoading={isWalletLoading}
            filteredModels={filteredModels}
            handleModelChange={handleModelChange}
            balance={balance}
            configuredModels={configuredModels}
            toggleConfiguredModel={toggleConfiguredModel}
            setModelProviderFor={setModelProviderFor}
            baseUrl={baseUrl}
            openModelsConfig={() => {
              setIsSettingsOpen(true);
              setInitialSettingsTab("models");
            }}
            lowBalanceWarningForModel={lowBalanceWarningForModel}
          />
        </div>

        {/* Balance Display */}
        <div className={`absolute ${isMobile ? "right-2" : "right-4"}`}>
          <BalanceDisplay
            setIsSettingsOpen={setIsSettingsOpen}
            setInitialSettingsTab={setInitialSettingsTab}
            onShowQRCode={onShowQRCode}
            isQrModalOpen={isQrModalOpen}
          />
        </div>
      </div>
    </div>
  );
};

export default ChatHeader;
