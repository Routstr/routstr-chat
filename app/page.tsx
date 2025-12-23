"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/context/AuthProvider";
import { ChatProvider } from "@/context/ChatProvider";
import ChatContainer from "@/components/chat/ChatContainer";
import SettingsModal from "@/components/SettingsModal";
import LoginModal from "@/components/LoginModal";
import TopUpPromptModal from "@/components/TopUpPromptModal";
import { QueryTimeoutModal } from "@/components/QueryTimeoutModal";
import QRCodeModal from "@/components/QRCodeModal";
import { useAuth } from "@/context/AuthProvider";
import { useChat } from "@/context/ChatProvider";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCashuWallet } from "@/features/wallet";
import { hasSeenTopUpPrompt, markTopUpPromptSeen } from "@/utils/storageUtils";
import { useAutoRefill } from "@/hooks/useAutoRefill";
import { KeepAliveProvider } from "@/components/pwa/KeepAliveProvider";

function ChatPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isAuthenticated, authChecked, logout } = useAuth();
  const {
    // UI State
    isSettingsOpen,
    setIsSettingsOpen,
    isLoginModalOpen,
    setIsLoginModalOpen,
    initialSettingsTab,

    // API State
    baseUrl,
    models,
    fetchModels,

    // Balance and Transaction State
    balance,
    setBalance,
    transactionHistory,
    setTransactionHistory,

    // Model State
    configuredModels,
    toggleConfiguredModel,
    setConfiguredModels,
    modelProviderMap,
    setModelProviderFor,

    // Chat State
    clearConversations,
    isBalanceLoading,
    conversations,
    loadConversation,
    activeConversationId,
    conversationsLoaded,
  } = useChat();

  const [isTopUpPromptOpen, setIsTopUpPromptOpen] = useState(false);
  const [topUpPromptDismissed, setTopUpPromptDismissed] = useState(false);
  const {
    showQueryTimeoutModal,
    setShowQueryTimeoutModal,
    didRelaysTimeout,
    setDidRelaysTimeout,
    isLoading: isWalletLoading,
  } = useCashuWallet();

  // Enable auto-refill functionality - monitors balance and triggers refills when enabled
  // Only triggers when wallet is fully loaded to avoid false positives from initial zero balance
  useAutoRefill({ balance, isWalletLoaded: !isWalletLoading });
  const pendingUrlSyncRef = useRef(false);
  const searchParamsString = useMemo(
    () => searchParams.toString(),
    [searchParams]
  );
  const chatIdFromUrl = useMemo(
    () => searchParams.get("chatId"),
    [searchParams]
  );
  const cashuTokenFromUrl = useMemo(
    () => searchParams.get("cashu"),
    [searchParams]
  );

  // QR Code Modal State
  const [qrModalData, setQrModalData] = useState<{
    invoice: string;
    amount: string;
    unit: string;
  } | null>(null);

  useEffect(() => {
    let topUpTimer: NodeJS.Timeout | null = null;

    if (!isBalanceLoading && balance === 0 && !isSettingsOpen) {
      if (!hasSeenTopUpPrompt() && !topUpPromptDismissed) {
        setIsTopUpPromptOpen(false);
        topUpTimer = setTimeout(() => {
          markTopUpPromptSeen();
          setIsTopUpPromptOpen(true);
        }, 500);
      }
    }

    return () => {
      if (topUpTimer) clearTimeout(topUpTimer);
    };
  }, [balance, isBalanceLoading, isSettingsOpen, topUpPromptDismissed]);

  const handleTopUp = (_amount?: number) => {};

  // Sync URL with activeConversationId
  // When activeConversationId is null (new chat), remove chatId from URL
  // When activeConversationId has a value, set chatId in URL
  useEffect(() => {
    const params = new URLSearchParams(searchParamsString);

    if (!activeConversationId) {
      // New chat state - remove chatId from URL if present
      if (chatIdFromUrl) {
        pendingUrlSyncRef.current = true;
        params.delete("chatId");
        const queryString = params.toString();
        router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, {
          scroll: false,
        });
      }
      return;
    }

    if (chatIdFromUrl === activeConversationId) return;

    pendingUrlSyncRef.current = true;
    params.set("chatId", activeConversationId);
    const queryString = params.toString();
    router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, {
      scroll: false,
    });
  }, [
    activeConversationId,
    chatIdFromUrl,
    pathname,
    router,
    searchParamsString,
  ]);

  useEffect(() => {
    if (!chatIdFromUrl) return;
    if (pendingUrlSyncRef.current) return;
    if (!conversationsLoaded) return;

    if (!conversations.length) {
      pendingUrlSyncRef.current = true;
      const params = new URLSearchParams(searchParamsString);
      params.delete("chatId");
      const queryString = params.toString();
      router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, {
        scroll: false,
      });
      return;
    }

    if (chatIdFromUrl === activeConversationId) return;

    const matchingConversation = conversations.find(
      (conversation) => conversation.id === chatIdFromUrl
    );
    if (matchingConversation) {
      loadConversation(chatIdFromUrl);
      return;
    }

    const fallbackConversation = conversations[0];
    if (fallbackConversation) {
      loadConversation(fallbackConversation.id);
    }
  }, [
    chatIdFromUrl,
    conversations,
    conversationsLoaded,
    activeConversationId,
    loadConversation,
    router,
    pathname,
    searchParamsString,
  ]);

  useEffect(() => {
    if (!pendingUrlSyncRef.current) return;

    if (activeConversationId && chatIdFromUrl === activeConversationId) {
      pendingUrlSyncRef.current = false;
      return;
    }

    if (!activeConversationId && !chatIdFromUrl) {
      pendingUrlSyncRef.current = false;
    }
  }, [chatIdFromUrl, activeConversationId]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-dvh w-full bg-background">
        <Loader2 className="h-8 w-8 text-white/50 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full bg-background text-foreground overflow-hidden">
      <ChatContainer
        onShowQRCode={setQrModalData}
        isQrModalOpen={!!qrModalData}
      />

      {/* Modals */}
      {isSettingsOpen && isAuthenticated && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          initialActiveTab={initialSettingsTab}
          baseUrl={baseUrl}
          models={models}
          balance={balance}
          setBalance={setBalance}
          clearConversations={clearConversations}
          logout={logout}
          router={router}
          transactionHistory={transactionHistory}
          setTransactionHistory={setTransactionHistory}
          configuredModels={configuredModels}
          toggleConfiguredModel={toggleConfiguredModel}
          setConfiguredModels={setConfiguredModels}
          modelProviderMap={modelProviderMap}
          setModelProviderFor={setModelProviderFor}
          fetchModels={fetchModels}
        />
      )}

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLogin={() => setIsLoginModalOpen(false)}
        logout={logout}
      />

      {/* Top-up Prompt */}
      {isTopUpPromptOpen && (
        <TopUpPromptModal
          isOpen={isTopUpPromptOpen}
          onClose={() => {
            setIsTopUpPromptOpen(false);
            setTopUpPromptDismissed(true);
          }}
          onTopUp={handleTopUp}
          onDontShowAgain={() => {
            setTopUpPromptDismissed(true);
            markTopUpPromptSeen();
          }}
          setIsLoginModalOpen={setIsLoginModalOpen}
          cashuToken={cashuTokenFromUrl || undefined}
        />
      )}

      <QueryTimeoutModal
        isOpen={showQueryTimeoutModal || (didRelaysTimeout && !isWalletLoading)}
        onClose={() => {
          console.log(
            "rdlogs: closing query timeout modal",
            showQueryTimeoutModal,
            didRelaysTimeout,
            isWalletLoading
          );
          setShowQueryTimeoutModal(false);
          setDidRelaysTimeout(false);
        }}
      />

      {/* QR Code Modal */}
      <QRCodeModal
        isOpen={!!qrModalData}
        onClose={() => setQrModalData(null)}
        invoice={qrModalData?.invoice || ""}
        amount={qrModalData?.amount || ""}
        unit={qrModalData?.unit || ""}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-dvh w-full bg-background">
          <Loader2 className="h-8 w-8 text-white/50 animate-spin" />
        </div>
      }
    >
      <AuthProvider>
        <ChatProvider>
          <KeepAliveProvider>
            <ChatPageContent />
          </KeepAliveProvider>
        </ChatProvider>
      </AuthProvider>
    </Suspense>
  );
}
