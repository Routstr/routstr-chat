'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider } from '@/context/AuthProvider';
import { ChatProvider } from '@/context/ChatProvider';
import ChatContainer from '@/components/chat/ChatContainer';
import SettingsModal from '@/components/SettingsModal';
import LoginModal from '@/components/LoginModal';
import TutorialOverlay from '@/components/TutorialOverlay';
import DepositModal from '@/components/DepositModal';
import { QueryTimeoutModal } from '@/components/QueryTimeoutModal';
import { useAuth } from '@/context/AuthProvider';
import { useChat } from '@/context/ChatProvider';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCashuWallet } from '@/hooks/useCashuWallet';

function ChatPageContent() {
  const router = useRouter();
  const { isAuthenticated, authChecked, logout } = useAuth();
  const {
    // UI State
    isSettingsOpen,
    setIsSettingsOpen,
    isLoginModalOpen,
    setIsLoginModalOpen,
    isTutorialOpen,
    initialSettingsTab,
    handleTutorialComplete,
    handleTutorialClose,
    
    // API State
    mintUrl,
    setMintUrl,
    baseUrl,
    setBaseUrl,
    selectedModel,
    handleModelChange,
    models,
    
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
    usingNip60,
    setUsingNip60,
    isBalanceLoading,
  } = useChat();

  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const { showQueryTimeoutModal, setShowQueryTimeoutModal, didRelaysTimeout, isLoading: isWalletLoading } = useCashuWallet();

  useEffect(() => {
    if (!isBalanceLoading && balance === 0 && isAuthenticated && !isSettingsOpen && !usingNip60) {
      setIsDepositModalOpen(true);
    } else {
      setIsDepositModalOpen(false);
    }
  }, [balance, isBalanceLoading, isAuthenticated, usingNip60]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-dvh w-full bg-black">
        <Loader2 className="h-8 w-8 text-white/50 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full bg-black text-white overflow-hidden">
      <ChatContainer />

      {/* Modals */}
      {isSettingsOpen && isAuthenticated && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          initialActiveTab={initialSettingsTab}
          mintUrl={mintUrl}
          setMintUrl={setMintUrl}
          baseUrl={baseUrl}
          setBaseUrl={setBaseUrl}
          selectedModel={selectedModel}
          handleModelChange={handleModelChange}
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
          usingNip60={usingNip60}
          setUsingNip60={(value) => {
            setUsingNip60(value);
          }}
        />
      )}

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLogin={() => setIsLoginModalOpen(false)}
      />

      {false && (<TutorialOverlay
        isOpen={isTutorialOpen}
        onComplete={handleTutorialComplete}
        onClose={handleTutorialClose}
      />)}

      {/* Deposit Modal */}
      {isDepositModalOpen && (
        <DepositModal
          isOpen={isDepositModalOpen}
          onClose={() => setIsDepositModalOpen(false)}
          mintUrl={mintUrl}
          balance={balance}
          setBalance={setBalance}
          usingNip60={usingNip60}
        />
      )}

      <QueryTimeoutModal
        isOpen={showQueryTimeoutModal || (didRelaysTimeout && !isWalletLoading)}
        onClose={() => setShowQueryTimeoutModal(false)}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-dvh w-full bg-black">
        <Loader2 className="h-8 w-8 text-white/50 animate-spin" />
      </div>
    }>
      <AuthProvider>
        <ChatProvider>
          <ChatPageContent />
        </ChatProvider>
      </AuthProvider>
    </Suspense>
  );
}
