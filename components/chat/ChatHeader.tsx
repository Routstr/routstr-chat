"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Menu, SquarePen, RotateCcw } from "lucide-react";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import ModelSelector from "./ModelSelector";
import { BalanceDisplay } from "@/features/wallet";
import { useSdkCachedBalance } from "@/hooks/useSdkCachedBalance";
import { ModalShell } from "@/components/ui/ModalShell";
import CloseButton from "@/components/ui/CloseButton";
import { toast } from "sonner";

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
    isModelDrawerOpen,
    setIsModelDrawerOpen,
    isWalletLoading,
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
    startNewConversation,

    // Balance
    balance,

    // API State
    lowBalanceWarningForModel,

    // Settings
    setIsSettingsOpen,
    setInitialSettingsTab,

    // Refund
    refundAllApiKeys,
  } = useChat();

  const sdkCachedBalance = useSdkCachedBalance();
  const cachedBalance = `${sdkCachedBalance} sats`;

  const showCachedBalance =
    isAuthenticated && sdkCachedBalance > 0;

  // Refund dialog state
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);

  const handleRefund = useCallback(async () => {
    setIsRefunding(true);
    try {
      const result = await refundAllApiKeys();
      if (result.totalRefunded > 0) {
        toast.success(
          `Refunded ${result.totalRefunded} item${result.totalRefunded > 1 ? "s" : ""} successfully!`,
        );
      }
      if (result.totalFailed > 0) {
        toast.warning(
          `${result.totalFailed} item${result.totalFailed > 1 ? "s" : ""} failed to refund.`,
        );
      }
      if (result.totalRefunded === 0 && result.totalFailed === 0) {
        toast.info("Nothing to refund.");
      }
    } catch (error) {
      toast.error(
        `Refund failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsRefunding(false);
      setShowRefundDialog(false);
    }
  }, [refundAllApiKeys]);

  // Debug: log why cached balance is/isn't showing
  useEffect(() => {
    if (!showCachedBalance && sdkCachedBalance > 0) {
      console.log(
        "[ChatHeader] cachedBalance hidden — isAuthenticated:",
        isAuthenticated,
        "sdkCachedBalance:",
        sdkCachedBalance,
      );
    }
  }, [showCachedBalance, isAuthenticated, sdkCachedBalance]);

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
            isLoadingModels={isLoadingModels}
            filteredModels={filteredModels}
            handleModelChange={handleModelChange}
            balance={balance}
            configuredModels={configuredModels}
            toggleConfiguredModel={toggleConfiguredModel}
            setModelProviderFor={setModelProviderFor}
            openModelsConfig={() => {
              setIsSettingsOpen(true);
              setInitialSettingsTab("models");
            }}
            lowBalanceWarningForModel={lowBalanceWarningForModel}
          />
        </div>

        {/* Balance Display */}
        <div
          className={`absolute ${isMobile ? "right-2" : "right-4"} flex ${isMobile ? "flex-col items-end gap-1" : "items-center gap-2"}`}
        >
          {showCachedBalance && (
            <button
              onClick={() => setShowRefundDialog(true)}
              className="flex flex-col items-end hover:opacity-80 transition-opacity cursor-pointer"
              title="Click to refund all cached balance"
            >
              <span className="text-xs text-muted-foreground font-medium">
                {cachedBalance}
              </span>
              <span className="text-[10px] text-muted-foreground/60 leading-none">
                (cached)
              </span>
            </button>
          )}
          <BalanceDisplay
            setIsSettingsOpen={setIsSettingsOpen}
            setInitialSettingsTab={setInitialSettingsTab}
            onShowQRCode={onShowQRCode}
            isQrModalOpen={isQrModalOpen}
          />
        </div>
      </div>

      {/* Refund Confirmation Dialog */}
      <ModalShell
        open={showRefundDialog}
        onClose={() => !isRefunding && setShowRefundDialog(false)}
        closeOnOverlayClick={!isRefunding}
        overlayClassName="bg-black/70 z-50"
        contentClassName="bg-card rounded-lg p-6 max-w-md w-full border border-border"
      >
        <div className="flex items-start justify-between mb-4">
          <h4 className="text-lg font-semibold text-foreground">
            Refund All Cached Balance
          </h4>
          <CloseButton
            onClick={() => !isRefunding && setShowRefundDialog(false)}
          />
        </div>
        {isRefunding ? (
          <div className="flex flex-col items-center py-4">
            <RotateCcw className="h-8 w-8 animate-spin text-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Refunding all API keys and xcashu tokens…
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              This will refund the remaining balance of{" "}
              <span className="font-semibold text-foreground">
                {cachedBalance}
              </span>{" "}
              across all your API keys and cached xcashu tokens back to your wallet as Cashu tokens.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                className="px-4 py-2 bg-transparent border border-border text-foreground/80 rounded-md text-sm hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                onClick={() => setShowRefundDialog(false)}
                disabled={isRefunding}
                type="button"
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-foreground text-background rounded-md text-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleRefund}
                disabled={isRefunding}
                type="button"
              >
                Refund All
              </button>
            </div>
          </>
        )}
      </ModalShell>
    </div>
  );
};

export default ChatHeader;
