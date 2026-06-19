"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthProvider";
import { useChat } from "@/context/ChatProvider";
import { formatPublicKey } from "@/lib/nostr";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import {
  useCashuWallet,
  useCreateCashuWallet,
  useCashuStore,
  calculateBalanceByMint,
} from "@/features/wallet";
import { isMintValid, getWalletMintData } from "@/utils/walletUtils";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import MintSelector from "@/features/wallet/components/balance/MintSelector";
import BalancePopoverHeader from "@/features/wallet/components/balance/BalancePopoverHeader";
import BalanceOverviewTab from "@/features/wallet/components/balance/BalanceOverviewTab";
import BalanceActivityTab from "@/features/wallet/components/balance/BalanceActivityTab";
import BalanceInvoiceTab from "@/features/wallet/components/balance/BalanceInvoiceTab";
import SendSection from "@/features/wallet/components/balance/SendSection";
import ReceiveSection from "@/features/wallet/components/balance/ReceiveSection";
import { useWalletReceive } from "@/features/wallet/hooks/useWalletReceive";

interface BalanceDisplayProps {
  setIsSettingsOpen: (isOpen: boolean) => void;
  setInitialSettingsTab: (
    tab: "settings" | "wallet" | "history" | "api-keys"
  ) => void;
  onShowQRCode: (data: { invoice: string; amount: string; unit: string }) => void;
  isQrModalOpen: boolean;
}

type ActiveTab = "overview" | "send" | "receive" | "activity" | "invoice";

const BalanceDisplay: React.FC<BalanceDisplayProps> = ({
  setIsSettingsOpen,
  setInitialSettingsTab,
  onShowQRCode,
  isQrModalOpen,
}) => {
  const { isAuthenticated } = useAuth();
  const {
    balance,
    activeAccount,
    currentMintUnit,
    isBalanceLoading,
    setIsLoginModalOpen,
    transactionHistory,
    setTransactionHistory,
  } = useChat();

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isMintSelectorOpen, setIsMintSelectorOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // Local balance with pending amounts
  const balanceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [localBalance, setLocalBalance] = useState(0);

  useEffect(() => {
    const tick = () => setLocalBalance(balance + getPendingCashuTokenAmount());
    tick();
    if (balanceIntervalRef.current) clearInterval(balanceIntervalRef.current);
    balanceIntervalRef.current = setInterval(tick, 210);
    return () => {
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
    };
  }, [balance]);

  // NIP-60 wallet hooks
  const { wallet, isLoading: isNip60Loading } = useCashuWallet();
  const {
    mutate: handleCreateWallet,
    isPending: isCreatingWallet,
  } = useCreateCashuWallet();
  const cashuStore = useCashuStore();

  const { availableMints, mintBalances, mintUnits } = React.useMemo(
    () => getWalletMintData(wallet, cashuStore, calculateBalanceByMint),
    [wallet, cashuStore.proofs, cashuStore.mints]
  );

  const hasMints = availableMints.length > 0;
  const isCurrentMintValid = isMintValid(cashuStore.activeMintUrl, availableMints);

  const handleMintSelection = (mintUrl: string) => {
    if (cashuStore.setActiveMintUrlByUser) {
      cashuStore.setActiveMintUrlByUser(mintUrl);
    } else {
      cashuStore.setActiveMintUrl(mintUrl);
    }
    setIsMintSelectorOpen(false);
  };

  const mintSelector = (
    <MintSelector
      availableMints={availableMints}
      activeMintUrl={cashuStore.activeMintUrl}
      isCurrentMintValid={isCurrentMintValid}
      isOpen={isMintSelectorOpen}
      onToggle={() => setIsMintSelectorOpen((open) => !open)}
      onSelect={handleMintSelection}
      mintBalances={mintBalances}
      mintUnits={mintUnits}
    />
  );

  const navigateToTab = useCallback((tab: ActiveTab) => {
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(tab);
      setIsTransitioning(false);
    }, 150);
  }, []);

  // Receive hook (needed here to pass invoice data to BalanceInvoiceTab)
  const receive = useWalletReceive(
    useCallback((tab: "overview" | "invoice") => navigateToTab(tab), [navigateToTab])
  );

  const npub = activeAccount?.pubkey ? formatPublicKey(activeAccount.pubkey) : "";
  const truncatedNpub =
    npub.length <= 16 ? npub : `${npub.slice(0, 8)}...${npub.slice(-6)}`;

  const displayBalance = isBalanceLoading
    ? "loading"
    : `${localBalance.toFixed(2)} sats`;

  const tabTitleMap: Record<ActiveTab, string> = {
    overview: "Wallet",
    send: "Send",
    receive: "Receive",
    activity: "Activity",
    invoice: "Invoice",
  };

  const openWalletSettings = (
    tab: "settings" | "wallet" | "history" | "api-keys" = "wallet"
  ) => {
    setIsSettingsOpen(true);
    setInitialSettingsTab(tab);
    setIsPopoverOpen(false);
  };

  const handleClearHistory = () => {
    if (
      window.confirm(
        "Are you sure you want to clear all transaction history? This cannot be undone."
      )
    ) {
      setTransactionHistory([]);
    }
  };

  // Reset on popover open
  React.useEffect(() => {
    if (isPopoverOpen) {
      setActiveTab("overview");
      setIsTransitioning(false);
      setIsMintSelectorOpen(false);
      receive.reset();
    }
  }, [isPopoverOpen]);

  if (!isAuthenticated) {
    return (
      <button
        onClick={() => setIsLoginModalOpen(true)}
        className="flex items-center gap-2 text-foreground bg-muted/50 hover:bg-muted rounded-md py-2 px-3 sm:px-4 h-[36px] text-xs sm:text-sm transition-colors cursor-pointer border border-border justify-center"
      >
        Sign in
      </button>
    );
  }

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        if (!open && isQrModalOpen) return;
        setIsPopoverOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-2 text-foreground bg-muted/50 hover:bg-muted rounded-md py-2 px-3 sm:px-4 h-[36px] text-xs sm:text-sm transition-colors cursor-pointer border border-border justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-wallet shrink-0"
          >
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
          </svg>
          <span className={isMobile ? "text-xs" : "text-sm"}>{displayBalance}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={isMobile ? 12 : 4}
        className={`${
          isMobile ? "w-[92vw]" : "w-72"
        } bg-card border border-border rounded-md shadow-lg p-0 max-h-[70vh] overflow-y-auto`}
      >
        <BalancePopoverHeader
          title={tabTitleMap[activeTab]}
          showBackButton={activeTab !== "overview" && activeTab !== "invoice"}
          onBack={() => navigateToTab("overview")}
          mintSelector={
            activeTab === "send" || activeTab === "receive" ? mintSelector : null
          }
          showSettings={activeTab === "overview"}
          onOpenSettings={() => openWalletSettings("wallet")}
          onShowHistory={() => navigateToTab("activity")}
        />

        <div
          className={`transition-all duration-300 ${
            isTransitioning
              ? "opacity-0 translate-x-2"
              : "opacity-100 translate-x-0"
          }`}
        >
          {!wallet && !isNip60Loading && !isCreatingWallet ? (
            <div className="p-4">
              <div className="bg-muted/50 border border-border rounded-md p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    You don&apos;t have a Cashu wallet yet
                  </span>
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => handleCreateWallet()}
                    disabled={!activeAccount}
                    className="bg-muted border border-border text-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50 cursor-pointer"
                    type="button"
                  >
                    Create Wallet
                  </button>
                  {!activeAccount && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 p-3 rounded-md text-sm mt-4">
                      <div className="flex items-center">
                        <AlertCircle className="h-4 w-4 mr-2" />
                        <span>You need to log in to create a wallet</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : isNip60Loading || isCreatingWallet ? (
            <div className="p-4">
              <div className="bg-muted/50 border border-border rounded-md p-4">
                <span className="text-sm text-muted-foreground">Loading wallet...</span>
              </div>
            </div>
          ) : (
            <>
              {activeTab === "overview" && (
                <BalanceOverviewTab
                  mintSelector={mintSelector}
                  truncatedNpub={truncatedNpub}
                  displayBalance={displayBalance}
                  onNavigate={(tab) => navigateToTab(tab)}
                />
              )}

              {activeTab === "send" && (
                <SendSection
                  mintBalances={mintBalances}
                  isCurrentMintValid={isCurrentMintValid}
                  hasMints={hasMints}
                />
              )}

              {activeTab === "receive" && (
                <ReceiveSection receive={receive} />
              )}

              {activeTab === "activity" && (
                <BalanceActivityTab
                  transactionHistory={transactionHistory}
                  onClearHistory={handleClearHistory}
                  onOpenSettings={() => openWalletSettings("wallet")}
                />
              )}

              {activeTab === "invoice" && (
                <BalanceInvoiceTab
                  onBack={() => navigateToTab("receive")}
                  bcStatus={receive.bcStatus}
                  bcBalance={receive.bcBalance}
                  onConnectWallet={receive.connectWallet}
                  invoice={receive.nip60Invoice}
                  mintAmount={receive.mintAmount}
                  currentMintUnit={currentMintUnit}
                  onShowQRCode={onShowQRCode}
                  onPayWithWallet={() =>
                    void receive.handlePayWithBitcoinConnect(
                      receive.nip60Invoice,
                      receive.nip60QuoteId
                    )
                  }
                  isPayingWithWallet={receive.isBcPaying}
                  copyToClipboard={async (text, type) => {
                    try {
                      await navigator.clipboard.writeText(text);
                    } catch {}
                  }}
                  copySuccess={false}
                />
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BalanceDisplay;
