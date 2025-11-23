'use client';

import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Model } from '@/data/models';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { TransactionHistory } from '@/types/chat';
import GeneralTab from './settings/GeneralTab';
import ModelsTab from '@/components/settings/ModelsTab';
import HistoryTab from './settings/HistoryTab';
import ApiKeysTab from './settings/ApiKeysTab';
import UnifiedWallet from '@/features/wallet/components/UnifiedWallet';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrLogin } from '@nostrify/react/login';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Drawer } from 'vaul';
import { DEFAULT_MINT_URL } from '@/lib/utils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialActiveTab?: 'settings' | 'wallet' | 'history' | 'api-keys' | 'models';
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  selectedModel: Model | null;
  handleModelChange: (modelId: string) => void;
  models: readonly Model[];
  balance: number;
  setBalance: (balance: number | ((prevBalance: number) => number)) => void;
  clearConversations: () => void;
  logout?: () => void;
  router?: AppRouterInstance;
  transactionHistory: TransactionHistory[];
  setTransactionHistory: (transactionHistory: TransactionHistory[] | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])) => void;
  configuredModels: string[];
  toggleConfiguredModel: (modelId: string) => void;
  setConfiguredModels?: (models: string[]) => void;
  modelProviderMap?: Record<string, string>;
  setModelProviderFor?: (modelId: string, baseUrl: string) => void;
  isMobile?: boolean;
}

const SettingsModal = ({
  isOpen,
  onClose,
  initialActiveTab,
  baseUrl,
  setBaseUrl,
  selectedModel,
  handleModelChange,
  models,
  balance,
  setBalance,
  clearConversations,
  logout,
  router,
  transactionHistory,
  setTransactionHistory,
  configuredModels,
  toggleConfiguredModel,
  setConfiguredModels,
  modelProviderMap,
  setModelProviderFor,
  isMobile: propIsMobile
}: SettingsModalProps) => {
  const { user } = useCurrentUser();
  const {logins} = useNostrLogin();
  const [activeTab, setActiveTab] = useState<'settings' | 'wallet' | 'history' | 'api-keys' | 'models'>(initialActiveTab || 'settings');
  const [baseUrls, setBaseUrls] = useState<string[]>([]); // State to hold base URLs
  const mediaQueryIsMobile = useMediaQuery('(max-width: 640px)');
  const isMobile = propIsMobile ?? mediaQueryIsMobile;

  // Derive base URLs from current baseUrl only (no defaults)
  useEffect(() => {
    const list = baseUrl ? [baseUrl] : [];
    setBaseUrls(list);
  }, [baseUrl]);


  if (!isOpen) return null;

  const contentBody = (
    <>
      <div className="bg-[#181818] flex justify-between items-center p-4 border-b border-white/10 flex-shrink-0">
        <h2 className="text-xl font-semibold text-white">Settings</h2>
        <button onClick={onClose} className="text-white/70 hover:text-white cursor-pointer">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 flex-shrink-0 overflow-x-auto">
        <button
          className={`px-4 py-2 text-sm font-medium flex-shrink-0 whitespace-nowrap ${activeTab === 'settings' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
          onClick={() => setActiveTab('settings')}
          type="button"
        >
          General
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium flex-shrink-0 whitespace-nowrap ${activeTab === 'models' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
          onClick={() => setActiveTab('models')}
          type="button"
        >
          Models
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium flex-shrink-0 whitespace-nowrap ${activeTab === 'wallet' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
          onClick={() => setActiveTab('wallet')}
          type="button"
        >
          Wallet
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium flex-shrink-0 whitespace-nowrap ${activeTab === 'history' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
          onClick={() => setActiveTab('history')}
          type="button"
        >
          History
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium flex-shrink-0 whitespace-nowrap ${activeTab === 'api-keys' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
          onClick={() => setActiveTab('api-keys')}
          type="button"
        >
          API Keys
        </button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        {activeTab === 'settings' ? (
          <GeneralTab
              publicKey={user?.pubkey}
              loginType={user?.method}
              logout={logout}
              router={router}
              onClose={onClose}
          />
        ) : activeTab === 'models' ? (
          <ModelsTab
            models={models}
            configuredModels={configuredModels}
            toggleConfiguredModel={toggleConfiguredModel}
            setConfiguredModels={setConfiguredModels}
            modelProviderMap={modelProviderMap}
            setModelProviderFor={setModelProviderFor}
          />
        ) : activeTab === 'history' ? (
          <HistoryTab
              transactionHistory={transactionHistory}
              setTransactionHistory={setTransactionHistory}
              clearConversations={clearConversations}
              onClose={onClose}
          />
        ) : activeTab === 'api-keys' ? (
          <ApiKeysTab
              baseUrl={baseUrl}
              baseUrls={baseUrls}
              setActiveTab={setActiveTab}
              isMobile={isMobile}
          />
        ) : activeTab === 'wallet' ? (
          <UnifiedWallet
            balance={balance}
            setBalance={setBalance}
            baseUrl={baseUrl}
            mintUrl={DEFAULT_MINT_URL}
            transactionHistory={transactionHistory}
            setTransactionHistory={setTransactionHistory}
          />
        ) : null}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Drawer.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          <Drawer.Content className="bg-[#181818] flex flex-col rounded-t-[10px] mt-24 h-[80%] lg:h-fit max-h-[96%] fixed bottom-0 left-0 right-0 outline-none z-[60]">
            <div className="pt-4 pb-4 bg-[#181818] rounded-t-[10px] flex-1 overflow-y-auto">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-white/20 mb-4" aria-hidden />
              <Drawer.Title className="sr-only">Settings</Drawer.Title>
              <div className="max-w-2xl mx-auto flex flex-col h-full">
                {contentBody}
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[#181818] rounded-lg overflow-hidden w-screen h-dvh m-0 sm:max-w-2xl sm:h-[80vh] sm:m-4 border border-white/10 shadow-lg flex flex-col"
        onClick={e => e.stopPropagation()}
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)'
        }}
      >
        {contentBody}
      </div>
    </div>
  );
};

export default SettingsModal;
