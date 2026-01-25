"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider } from "@/context/AuthProvider";
import { ChatProvider } from "@/context/ChatProvider";
import ChatContainer from "@/components/chat/ChatContainer";
import SettingsModal from "@/components/SettingsModal";
import TopUpPromptModal from "@/components/TopUpPromptModal";
import { QueryTimeoutModal } from "@/components/QueryTimeoutModal";
import QRCodeModal from "@/components/QRCodeModal";
import { useAuth } from "@/context/AuthProvider";
import { useChat } from "@/context/ChatProvider";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCashuWallet } from "@/features/wallet";
import { useAutoRefill } from "@/hooks/useAutoRefill";
import {
  KeepAliveProvider,
  useKeepAliveContext,
} from "@/components/pwa/KeepAliveProvider";

const FullPageLoader = () => (
  <div className="flex items-center justify-center h-dvh w-full bg-background">
    <Loader2 className="h-8 w-8 text-white/50 animate-spin" />
  </div>
);

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
    setInitialSettingsTab,

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

    // Streaming State
    isLoading: isStreaming,
  } = useChat();

  // Keep-alive: sync with streaming state
  const {
    startKeepAlive,
    stopKeepAlive,
    isEnabled: keepAliveEnabled,
  } = useKeepAliveContext();

  useEffect(() => {
    if (!keepAliveEnabled) return;

    if (isStreaming) {
      startKeepAlive();
    } else {
      stopKeepAlive();
    }
  }, [isStreaming, keepAliveEnabled, startKeepAlive, stopKeepAlive]);

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
  const previousActiveConversationIdRef = useRef<string | null>(null);
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
  const tabFromUrl = useMemo(() => searchParams.get("tab"), [searchParams]);

  useEffect(() => {
    if (tabFromUrl === "apikeys" && isAuthenticated) {
      setIsSettingsOpen(true);
      setInitialSettingsTab("api-keys");

      const params = new URLSearchParams(searchParamsString);
      params.delete("tab");
      const queryString = params.toString();
      router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`, {
        scroll: false,
      });
    }
  }, [
    tabFromUrl,
    isAuthenticated,
    setIsSettingsOpen,
    setInitialSettingsTab,
    router,
    pathname,
    searchParamsString,
  ]);

  // QR Code Modal State
  const [qrModalData, setQrModalData] = useState<{
    invoice: string;
    amount: string;
    unit: string;
  } | null>(null);

  useEffect(() => {
    let topUpTimer: NodeJS.Timeout | null = null;

    const shouldPrompt =
      balance === 0 &&
      !isSettingsOpen &&
      !topUpPromptDismissed &&
      (!isBalanceLoading || !isAuthenticated);

    if (shouldPrompt && !isTopUpPromptOpen && !isLoginModalOpen) {
      topUpTimer = setTimeout(() => {
        setIsTopUpPromptOpen(true);
      }, 500);
    }

    return () => {
      if (topUpTimer) clearTimeout(topUpTimer);
    };
  }, [
    balance,
    isBalanceLoading,
    isSettingsOpen,
    topUpPromptDismissed,
    isAuthenticated,
    isTopUpPromptOpen,
    isLoginModalOpen,
  ]);

  useEffect(() => {
    if (isTopUpPromptOpen && balance > 0) {
      setIsTopUpPromptOpen(false);
    }
  }, [balance, isTopUpPromptOpen]);

  const isAuthModalOpen = isLoginModalOpen || isTopUpPromptOpen;
  const authModalDefaultPage = isLoginModalOpen ? "login" : "topup";

  const handleAuthModalClose = () => {
    if (isLoginModalOpen) {
      setIsLoginModalOpen(false);
    }
    if (isTopUpPromptOpen) {
      setIsTopUpPromptOpen(false);
      setTopUpPromptDismissed(true);
    }
  };

  // Sync URL with activeConversationId
  // When activeConversationId is null (new chat), remove chatId from URL
  // When activeConversationId has a value, set chatId in URL
  useEffect(() => {
    const previousActiveConversationId =
      previousActiveConversationIdRef.current;
    previousActiveConversationIdRef.current = activeConversationId;
    const params = new URLSearchParams(searchParamsString);

    if (!activeConversationId) {
      // New chat state - remove chatId from URL if present
      if (chatIdFromUrl && previousActiveConversationId) {
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

    // If chatId matches the active conversation, nothing to do
    if (chatIdFromUrl === activeConversationId) return;

    // Try to find and load the conversation matching the URL chatId
    const matchingConversation = conversations.find(
      (conversation) => conversation.id === chatIdFromUrl
    );
    if (matchingConversation) {
      loadConversation(chatIdFromUrl);
      return;
    }

    // Only remove chatId from URL if we have other conversations but this one doesn't exist
    // This prevents removing the chatId when conversations are still being synced (empty array)
    if (conversations.length > 0) {
      // The chatId doesn't match any existing conversation, load most recent one
      const fallbackConversation = conversations[0];
      if (fallbackConversation) {
        loadConversation(fallbackConversation.id);
      }
    }
    // If conversations.length === 0, keep the chatId in URL - it might load after sync
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
    return <FullPageLoader />;
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

      {isAuthModalOpen && (
        <TopUpPromptModal
          isOpen={isAuthModalOpen}
          onClose={handleAuthModalClose}
          cashuToken={cashuTokenFromUrl || undefined}
          defaultPage={authModalDefaultPage}
          onShowQRCode={setQrModalData}
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
    <Suspense fallback={<FullPageLoader />}>
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
