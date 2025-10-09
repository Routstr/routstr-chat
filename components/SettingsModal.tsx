'use client';

import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { Model } from '@/data/models';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { TransactionHistory } from '@/types/chat';

// Import new components
import GeneralTab from './settings/GeneralTab';
import ModelsTab from '@/components/settings/ModelsTab';
import WalletTab from './settings/WalletTab';
import HistoryTab from './settings/HistoryTab';
import ApiKeysTab from './settings/ApiKeysTab';
import UnifiedWallet from './settings/UnifiedWallet';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrLogin } from '@nostrify/react/login';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialActiveTab?: 'settings' | 'wallet' | 'history' | 'api-keys' | 'models';
  mintUrl: string;
  setMintUrl: (url: string) => void;
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
  usingNip60: boolean;
  setUsingNip60: (usingNip60: boolean) => void;
}

const SettingsModal = ({
  isOpen,
  onClose,
  initialActiveTab,
  mintUrl,
  setMintUrl,
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
  usingNip60,
  setUsingNip60
}: SettingsModalProps) => {
  const { user } = useCurrentUser();
  const {logins} = useNostrLogin();
  const [activeTab, setActiveTab] = useState<'settings' | 'wallet' | 'history' | 'api-keys' | 'models'>(initialActiveTab || 'settings');
  const [baseUrls, setBaseUrls] = useState<string[]>([]); // State to hold base URLs

  // Effect to load base URLs from localStorage
  useEffect(() => {
    const storedBaseUrls = localStorage.getItem('base_urls_list');
    let initialBaseUrls: string[] = [];

    if (storedBaseUrls) {
      initialBaseUrls = JSON.parse(storedBaseUrls);
    }

    // Ensure baseUrl is always in the list if it's a valid URL
    if (baseUrl && !initialBaseUrls.includes(baseUrl)) {
      initialBaseUrls = [baseUrl, ...initialBaseUrls];
    }

    // If no URLs are stored and baseUrl is also empty, add a default
    if (initialBaseUrls.length === 0) {
      initialBaseUrls = ['https://api.routstr.com/'];
    }

    setBaseUrls(initialBaseUrls);
  }, [baseUrl]); // Re-run if baseUrl prop changes


  // Handle auto-saving mint URL changes
  const handleMintUrlChange = useCallback((url: string) => {
    setMintUrl(url);
    localStorage.setItem('mint_url', url);
  }, [setMintUrl]);


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-black rounded-lg w-screen h-dvh m-0 sm:max-w-2xl sm:h-[80vh] sm:m-4 border border-white/10 flex flex-col"
        onClick={e => e.stopPropagation()}
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)'
        }}
      >
        <div className="flex justify-between items-center p-4 border-b border-white/10 flex-shrink-0">
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
                nsecData={logins[0].data}
                loginType={user?.method}
                logout={logout}
                router={router}
                onClose={onClose}
                mintUrl={mintUrl}
                setMintUrl={handleMintUrlChange}
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
                mintUrl={mintUrl}
                baseUrl={baseUrl}
                usingNip60={usingNip60}
                baseUrls={baseUrls} // Pass baseUrls to ApiKeysTab
                setActiveTab={setActiveTab} // Pass setActiveTab to ApiKeysTab
            />
          ) : activeTab === 'wallet' ? (
            <UnifiedWallet
              balance={balance}
              setBalance={setBalance}
              mintUrl={mintUrl}
              baseUrl={baseUrl}
              transactionHistory={transactionHistory}
              setTransactionHistory={setTransactionHistory}
              usingNip60={usingNip60}
              setUsingNip60={setUsingNip60}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
