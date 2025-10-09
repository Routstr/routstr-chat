'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Copy, Eye, EyeOff, Info, Check, Plus, RefreshCw, Key, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { getBalanceFromStoredProofs, refundRemainingBalance, create60CashuToken, generateApiToken, unifiedRefund } from '@/utils/cashuUtils';
import { toast } from 'sonner';
import { useApiKeysSync } from '@/hooks/useApiKeysSync'; // Import the new hook
import { useCurrentUser } from '@/hooks/useCurrentUser'; // For checking user login
import { useCashuStore } from '@/stores/cashuStore';
import { useCashuToken } from '@/hooks/useCashuToken';
import { calculateBalance } from '@/lib/cashu';

export interface StoredApiKey {
  key: string;
  balance: number | null; // Changed to accept null for invalid keys
  label?: string; // Added optional label field
  baseUrl?: string; // Added optional baseUrl field
  isInvalid?: boolean; // New field to mark invalid keys
}

interface ApiKeysTabProps {
  mintUrl: string;
  baseUrl: string;
  usingNip60: boolean;
  baseUrls: string[]; // Add baseUrls to props
  setActiveTab: (tab: 'settings' | 'wallet' | 'history' | 'api-keys') => void; // New prop
}

const ApiKeysTab = ({ mintUrl, baseUrl, usingNip60, baseUrls, setActiveTab }: ApiKeysTabProps) => {
  const { user } = useCurrentUser();
  const {
    syncedApiKeys,
    isLoadingApiKeys,
    isSyncingApiKeys,
    createOrUpdateApiKeys,
    deleteApiKey,
    cloudSyncEnabled,
    setCloudSyncEnabled
  } = useApiKeysSync();
  const cashuStore = useCashuStore();
  const { sendToken, receiveToken } = useCashuToken();

  const [localMintBalance, setLocalMintBalance] = useState(0);

  const { balances: mintBalances, units: mintUnits } = useMemo(() => {
    if (!cashuStore.proofs) return { balances: {}, units: {} };
    return calculateBalance(cashuStore.proofs);
  }, [cashuStore.proofs]);

  useEffect(() => {
    if (!usingNip60) {
      setLocalMintBalance(getBalanceFromStoredProofs());
    } else if (cashuStore.activeMintUrl && mintBalances[cashuStore.activeMintUrl]) {
      const balance = mintBalances[cashuStore.activeMintUrl];
      const unit = mintUnits[cashuStore.activeMintUrl];
      if (unit === 'msat') {
        setLocalMintBalance(balance / 1000);
      } else {
        setLocalMintBalance(balance);
      }
    } else {
      setLocalMintBalance(0);
    }
  }, [mintBalances, mintUnits, cashuStore.activeMintUrl, usingNip60]);

  const [showTooltip, setShowTooltip] = useState(false); // New state for tooltip visibility
  const [apiKeyAmount, setApiKeyAmount] = useState('');
  const [storedApiKeys, setStoredApiKeys] = useState<StoredApiKey[]>([]); // This will now primarily represent the active keys
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // Added isLoading state (for minting, not sync)
  const [isRefundingKey, setIsRefundingKey] = useState<string | null>(null); // New state for refund loading
  const [isDeletingKey, setIsDeletingKey] = useState<string | null>(null); // New state for delete loading
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false); // New state for refresh balances loading
  const [newApiKeyLabel, setNewApiKeyLabel] = useState(''); // Added state for new API key label
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false); // New state for delete confirmation modal
  const [keyToDeleteConfirmation, setKeyToDeleteConfirmation] = useState<string | null>(null); // Key to delete in confirmation modal
  const [isTopUpLoading, setIsTopUpLoading] = useState<string | null>(null); // New state for topup loading
  const [showTopUpModal, setShowTopUpModal] = useState(false); // New state for topup modal
  const [topUpAmount, setTopUpAmount] = useState(''); // New state for topup amount
  const [keyToTopUp, setKeyToTopUp] = useState<StoredApiKey | null>(null); // Key to topup
  const [selectedNewApiKeyBaseUrl, setSelectedNewApiKeyBaseUrl] = useState<string>(baseUrl); // New state for base URL during API key creation
  const [refundFailed, setRefundFailed] = useState(false); // New state to track refund failures
  const [copiedKey, setCopiedKey] = useState<string | null>(null); // Track which key was recently copied
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false); // New state for add API key modal
  const [manualApiKey, setManualApiKey] = useState(''); // New state for manual API key input
  const [manualApiKeyLabel, setManualApiKeyLabel] = useState(''); // New state for manual API key label
  const [selectedManualApiKeyBaseUrl, setSelectedManualApiKeyBaseUrl] = useState<string>(baseUrl); // New state for manual API key base URL
  const [isAddingApiKey, setIsAddingApiKey] = useState(false); // New state for adding API key loading
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set()); // New state for tracking expanded API keys

  // Ref to track previous syncedApiKeys for deep comparison
  const prevSyncedApiKeysRef = useRef<StoredApiKey[]>([]);

  // Helper function to deep compare API keys arrays
  const areApiKeysEqual = (keys1: StoredApiKey[], keys2: StoredApiKey[]): boolean => {
    if (keys1.length !== keys2.length) return false;
    
    return keys1.every((key1, index) => {
      const key2 = keys2[index];
      return key1.key === key2.key &&
             key1.balance === key2.balance &&
             key1.label === key2.label &&
             key1.baseUrl === key2.baseUrl &&
             key1.isInvalid === key2.isInvalid;
    });
  };

  // Helper function to toggle expanded state for API keys
  const toggleExpanded = (key: string) => {
    setExpandedKeys(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Effect to update selectedNewApiKeyBaseUrl if baseUrl prop changes
  useEffect(() => {
    setSelectedNewApiKeyBaseUrl(baseUrl);
  }, [baseUrl]);

  // Effect to manage API keys based on cloud sync setting
  useEffect(() => {
    if (cloudSyncEnabled && user) {
      // Only update if syncedApiKeys content actually changed
      if (!areApiKeysEqual(prevSyncedApiKeysRef.current, syncedApiKeys)) {
        setStoredApiKeys(syncedApiKeys);
        prevSyncedApiKeysRef.current = syncedApiKeys;
      }

      // Migrate local keys to cloud if any exist and cloud is empty
      const localKeys = typeof window !== 'undefined' ? localStorage.getItem('api_keys') : null; // Check if window is defined (for SSR safety)
      if (localKeys && JSON.parse(localKeys).length > 0 && syncedApiKeys.length === 0) {
        toast.info('Migrating local API keys to cloud...');
        const parsedLocalKeys: StoredApiKey[] = JSON.parse(localKeys);
        createOrUpdateApiKeys(parsedLocalKeys)
          .then(() => {
            if (typeof window !== 'undefined') { // Check if window is defined (for SSR safety)
              localStorage.removeItem('api_keys'); // Clear local storage after successful migration
            }
            toast.success('Local API keys migrated to cloud!');
          })
          .catch((error) => {
            toast.error(`Failed to migrate local API keys: ${error.message}`);
            // If migration fails, revert cloudSyncEnabled to false? Or notify user to try again.
          });
      }
      // refreshApiKeysBalances(); // Refresh balances immediately after sync
    } else {
      // When cloud sync is disabled or no user, use local storage
      const storedKeys = typeof window !== 'undefined' ? localStorage.getItem('api_keys') : null;
      if (storedKeys) {
        const parsedKeys: StoredApiKey[] = JSON.parse(storedKeys);
        const newLocalKeys = parsedKeys.map(key => ({ ...key, label: key.label || 'Unnamed', baseUrl: key.baseUrl || baseUrl }));
        setStoredApiKeys(prevKeys => {
          // Perform a deep equality check for array content to prevent unnecessary re-renders
          if (prevKeys.length !== newLocalKeys.length) {
            return newLocalKeys;
          }
          // Compare elements by their 'key' property (assuming it's unique)
          const prevKeysMap = new Map(prevKeys.map(k => [k.key, k]));
          const hasChanged = newLocalKeys.some(newKey => {
              const prevKey = prevKeysMap.get(newKey.key);
              // Check if key is missing, or any relevant property differs
              return !prevKey ||
                     prevKey.balance !== newKey.balance ||
                     prevKey.label !== newKey.label ||
                     prevKey.baseUrl !== newKey.baseUrl;
          });
          // Also check if any key was removed
          const keysRemoved = prevKeys.some(prevKey => !new Map(newLocalKeys.map(k => [k.key, k])).has(prevKey.key));

          if (hasChanged || keysRemoved) {
              return newLocalKeys;
          }
          return prevKeys; // No change if content is deeply equal
        });
      } else { // No stored keys in localStorage
        setStoredApiKeys(prevKeys => (prevKeys.length > 0 ? [] : prevKeys)); // Only clear if not already empty
      }
    }
  }, [cloudSyncEnabled, user, syncedApiKeys, baseUrl]); // Added syncedApiKeys back with proper deep comparison

  const handleCopyClick = async (keyToCopy: string) => {
    if (keyToCopy) {
      try {
        await navigator.clipboard.writeText(keyToCopy);
        setCopiedKey(keyToCopy);
        toast.success('Copied!');
        setTimeout(() => setCopiedKey(null), 2000); // Clear copied state after 2 seconds
      } catch (err) {
        toast.error('Failed to copy!');
      }
    }
  };

  const createApiKey = async () => {

    setShowConfirmation(true);
  };

  const confirmCreateApiKey = async () => {
    setIsLoading(true); // Set loading to true
    try {
      let token: string | null | { hasTokens: false } | undefined;

      if (!apiKeyAmount || parseInt(apiKeyAmount) <= 0) {
        alert('Please enter a valid amount for the API key.');
        return;
      }
      
      if (usingNip60) {
        if (!cashuStore.activeMintUrl) {
          toast.error('No active mint selected');
          return;
        }
        console.log("tryuing my best");
        token = await create60CashuToken(
          cashuStore.activeMintUrl,
          sendToken,
          parseInt(apiKeyAmount)
        );
      } else {
        token = await generateApiToken(mintUrl, parseInt(apiKeyAmount));
      }

      if (!token) {
        toast.error('Failed to generate Cashu token for API key creation.');
        return;
      }

      const response = await fetch(`${selectedNewApiKeyBaseUrl}v1/wallet/info`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch API key from wallet endpoint');
      }

      const data = await response.json();
      const newApiKey = data.api_key;
      const newApiKeyBalance = data.balance;

      const newStoredKey: StoredApiKey = { key: newApiKey, balance: parseInt(newApiKeyBalance), label: newApiKeyLabel || 'Unnamed', baseUrl: selectedNewApiKeyBaseUrl, isInvalid: false }; // Include label, baseUrl, and isInvalid
      const updatedKeys = [...storedApiKeys, newStoredKey];

      if (cloudSyncEnabled) {
        await createOrUpdateApiKeys(updatedKeys);
        toast.success('API Key created and synced to cloud successfully!');
      } else {
        localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
        toast.success('API Key created and stored locally!');
      }
      
      setStoredApiKeys(updatedKeys);
      setApiKeyAmount('');
      setNewApiKeyLabel(''); // Clear label input
    } catch (error) {
      console.error('Error creating API key:', error);
      toast.error(`Error creating API key: ${error instanceof Error ? error.message : String(error)}`); // Use toast
    } finally {
      setIsLoading(false); // Set loading to false
      setShowConfirmation(false); // Close confirmation modal after loading is complete
    }
  };

  const refreshApiKeysBalances = async () => {
    setIsRefreshingBalances(true); // Set loading state
    const updatedKeys: StoredApiKey[] = [];
    try {
      for (const keyData of storedApiKeys) {
        const urlToUse = keyData.baseUrl || baseUrl; // Use key-specific baseUrl or fallback to global
        try {
          const response = await fetch(`${urlToUse}v1/wallet/info`, {
            headers: {
              'Authorization': `Bearer ${keyData.key}`
            }
          });
          if (!response.ok) {
            console.error(`Failed to refresh balance for key ${keyData.key}:`, response);
            const data = await response.json();
            if (data.detail?.error?.code === "invalid_api_key") {
              updatedKeys.push({ ...keyData, balance: null, isInvalid: true }); // Mark as invalid and set balance to null
            } else {
              updatedKeys.push(keyData); // Keep old data if refresh fails or other error
            }
            continue;
          }

          const data = await response.json();
          updatedKeys.push({ ...keyData, balance: data.balance, isInvalid: false }); // Set isInvalid to false on successful refresh
        } catch (error) {
          console.error(`Error refreshing balance for key ${keyData.key}:`, error);
          if (error instanceof TypeError) {
            toast.error(`Base URL ${urlToUse} is not responding. Skipping key ${keyData.key}.`);
            updatedKeys.push({ ...keyData, balance: null, isInvalid: true }); // Mark as invalid if base URL is not responding
          } else {
            toast.error(`Error refreshing balance for key ${keyData.key}: ${error instanceof Error ? error.message : String(error)}`);
            updatedKeys.push(keyData); // Keep old data if other error occurs
          }
        }
      }
      // Update local storage if not cloud syncing, otherwise the hook will handle it
      setStoredApiKeys(updatedKeys);
      if (cloudSyncEnabled) {
        await createOrUpdateApiKeys(updatedKeys); // Sync updated keys to cloud
        toast.success('API Key balances refreshed and synced to cloud!');
      } else {
        localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
        toast.success('API Key balances refreshed!');
      }
    } finally {
      setIsRefreshingBalances(false); // Reset loading state
    }
  };

  const handleDeleteApiKey = (keyToDelete: string) => {
    setKeyToDeleteConfirmation(keyToDelete);
    setShowDeleteConfirmation(true);
  };

  const confirmDeleteApiKey = async () => {
    if (!keyToDeleteConfirmation) return;

    // If refund failed and we're showing the refund failure confirmation
    if (refundFailed) {
      proceedWithDeletion(keyToDeleteConfirmation);
      return;
    }

    setIsDeletingKey(keyToDeleteConfirmation); // Set loading for this specific key
    setShowDeleteConfirmation(false); // Close the confirmation modal
    try {
      // Find the key data to get its balance
      const keyDataToDelete = storedApiKeys.find(keyData => keyData.key === keyToDeleteConfirmation);

      if (keyDataToDelete) {
        // Attempt to refund the balance
        const urlToUse = keyDataToDelete.baseUrl || baseUrl; // Use key-specific baseUrl or fallback to global
        const refundResult = await unifiedRefund(mintUrl, urlToUse, usingNip60, receiveToken, keyDataToDelete.key);

        if (refundResult.success) {
          toast.success(refundResult.message || 'API Key balance refunded successfully!');
          // Proceed with deletion after successful refund
          proceedWithDeletion(keyToDeleteConfirmation);
        } else {
          // Refund failed - ask for user confirmation before deleting
          setRefundFailed(true);
          setShowDeleteConfirmation(true);
        }
      } else {
        // No key data found, proceed with deletion
        proceedWithDeletion(keyToDeleteConfirmation);
      }
    } catch (error) {
      console.error('Error deleting API key:', error);
      toast.error(`Error deleting API key: ${error instanceof Error ? error.message : String(error)}`);
      setIsDeletingKey(null);
      setKeyToDeleteConfirmation(null);
    }
  };

  const proceedWithDeletion = async (keyToDelete: string) => {
    if (!keyToDelete) return;
    
    const updatedKeys = storedApiKeys.filter(keyData => keyData.key !== keyToDelete);
    
    if (cloudSyncEnabled) {
      await deleteApiKey(keyToDelete); // The hook handles updating the cloud
      toast.success('API Key deleted and synced to cloud successfully!');
    } else {
      localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
      toast.success('API Key deleted locally!');
    }

    setStoredApiKeys(updatedKeys);
    setIsDeletingKey(null); // Reset loading
    setKeyToDeleteConfirmation(null); // Clear the key to delete
    setShowDeleteConfirmation(false); // Close any confirmation modals
    setRefundFailed(false); // Reset refund failure state
  };

  const handleTopUp = (keyData: StoredApiKey) => {
    setKeyToTopUp(keyData);
    setShowTopUpModal(true);
  };

  const confirmTopUp = async () => {
    if (!keyToTopUp || !topUpAmount || parseInt(topUpAmount) <= 0) {
      toast.error('Please enter a valid amount for top up.');
      return;
    }

    setIsTopUpLoading(keyToTopUp.key);
    setShowTopUpModal(false);
    
    const urlToUse = keyToTopUp.baseUrl || baseUrl; // Moved here
    try {
      let cashuToken: string | null | { hasTokens: false } | undefined;
      
      // Create cashu token based on the wallet type
      if (usingNip60) {
        if (!cashuStore.activeMintUrl) {
          toast.error('No active mint selected');
          return;
        }
        cashuToken = await create60CashuToken(
          cashuStore.activeMintUrl,
          sendToken,
          parseInt(topUpAmount)
        );
      } else {
        cashuToken = await generateApiToken(mintUrl, parseInt(topUpAmount));
      }

      if (!cashuToken) {
        toast.error('Failed to generate Cashu token for top up.');
        return;
      }

      // Use the key-specific baseUrl or fallback to global baseUrl
      // Make the topup request to the backend
      const response = await fetch(`${urlToUse}v1/wallet/topup?cashu_token=${encodeURIComponent(cashuToken)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${keyToTopUp.key}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Top up failed with status ${response.status}`);
      }

      const data = await response.json();
      toast.success(`Successfully topped up ${topUpAmount} sats!`);
      
      // Refresh the API key balances to show the updated balance
      await refreshApiKeysBalances();
      
    } catch (error) {
      console.error('Error during top up:', error);
      if (error instanceof TypeError) {
        toast.error(`Base URL ${urlToUse} is not responding. Top up failed.`);
      } else {
        toast.error(`Top up failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setIsTopUpLoading(null);
      setTopUpAmount('');
      setKeyToTopUp(null);
    }
  };

  const handleAddApiKey = () => {
    setShowAddApiKeyModal(true);
    setSelectedManualApiKeyBaseUrl(baseUrl); // Reset to default base URL
  };

  const confirmAddApiKey = async () => {
    if (!manualApiKey || !manualApiKey.trim()) {
      toast.error('Please enter a valid API key.');
      return;
    }

    setIsAddingApiKey(true);
    try {
      // Verify the API key by fetching wallet info
      const response = await fetch(`${selectedManualApiKeyBaseUrl}v1/wallet/info`, {
        headers: {
          'Authorization': `Bearer ${manualApiKey}`
        }
      });

      if (!response.ok) {
        const data = await response.json();
        if (data.detail?.error?.code === "invalid_api_key") {
          throw new Error('Invalid API key');
        }
        throw new Error('Failed to verify API key');
      }

      const data = await response.json();
      const apiKeyBalance = data.balance;

      const newStoredKey: StoredApiKey = {
        key: manualApiKey,
        balance: parseInt(apiKeyBalance),
        label: manualApiKeyLabel || 'Manually Added',
        baseUrl: selectedManualApiKeyBaseUrl,
        isInvalid: false
      };
      
      const updatedKeys = [...storedApiKeys, newStoredKey];

      if (cloudSyncEnabled) {
        await createOrUpdateApiKeys(updatedKeys);
        toast.success('API Key added and synced to cloud successfully!');
      } else {
        localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
        toast.success('API Key added and stored locally!');
      }
      
      setStoredApiKeys(updatedKeys);
      setManualApiKey('');
      setManualApiKeyLabel('');
      setShowAddApiKeyModal(false);
    } catch (error) {
      console.error('Error adding API key:', error);
      toast.error(`Error adding API key: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsAddingApiKey(false);
    }
  };
 
  return (
    <div className="space-y-4 text-white relative"> {/* Added relative positioning back */}
      <h3 className="text-lg font-semibold">API Keys</h3>

      {user && (
        <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">Sync with Cloud (Nostr)</span>
            <div
              className="relative inline-block"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            >
              <Info className="h-4 w-4 text-white/60 hover:text-white transition-colors cursor-pointer" />
              <div
                className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 bg-black text-white text-xs rounded-md shadow-lg transition-opacity duration-300 w-64 border border-white/30 whitespace-normal z-50 ${
                  showTooltip ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
              >
                <p>API keys are synced with Nostr using <span className="font-semibold">NIP-78</span> (Kind 30078) for addressable replaceable events.</p>
                <p className="mt-1">Data is encrypted using <span className="font-semibold">NIP-44</span> for enhanced security and privacy.</p>
              </div>
            </div>
                     </div>
           <button
             role="switch"
             aria-checked={cloudSyncEnabled}
             onClick={() => setCloudSyncEnabled(!cloudSyncEnabled)}
             className={`${
               cloudSyncEnabled ? 'bg-white' : 'bg-white/20'
             } inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer`}
           >
             <span
               className={`${
                 cloudSyncEnabled ? 'translate-x-[calc(100%-2px)] bg-black' : 'translate-x-0 bg-white'
               } pointer-events-none block size-4 rounded-full ring-0 transition-transform`}
             />
           </button>
         </div>
       )}

      <div>
        <p className="text-sm text-white/70">Available Balance:</p>
        <p className="text-lg font-medium">
          {localMintBalance} sats
          {usingNip60 && cashuStore.activeMintUrl && (
            <span className="text-xs text-white/50 ml-2">
              ({cashuStore.activeMintUrl.replace(/^https?:\/\//, '')})
              <button
                onClick={() => setActiveTab('wallet')}
                className="ml-2 text-blue-400 hover:text-blue-300 text-xs font-medium"
                type="button"
              >
                Switch
              </button>
            </span>
          )}
        </p>
        {usingNip60 && cashuStore.proofs && Object.keys(mintBalances).length > 1 && (() => {
          let totalBalance = 0;
          for (const mintUrl in mintBalances) {
            const balance = mintBalances[mintUrl];
            const unit = mintUnits[mintUrl];
            if (unit === 'msat') {
              totalBalance += balance / 1000;
            } else {
              totalBalance += balance;
            }
          }
          // Only display total balance if it's different from the current mint balance
          return localMintBalance !== totalBalance && (
            <p className="text-sm text-white/70 mt-2">
              Total Balance: {totalBalance} sats
            </p>
          );
        })()}
      </div>

      {(isLoadingApiKeys || isSyncingApiKeys) && (
        <div className="mb-4 flex items-center text-white/70">
          <svg className="animate-spin h-5 w-5 mr-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {isLoadingApiKeys ? 'Loading API Keys...' : 'Syncing API Keys...'}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/20 text-white/80 rounded-md text-sm font-medium hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
            onClick={createApiKey}
            disabled={isLoading || isSyncingApiKeys}
          >
            <Plus className="h-4 w-4" />
            {isLoading ? 'Creating...' : 'Create New API Key'}
          </button>
          <button
            className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/20 text-white/80 rounded-md text-sm font-medium hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
            onClick={handleAddApiKey}
            disabled={isAddingApiKey || isSyncingApiKeys}
          >
            <Key className="h-4 w-4" />
            {isAddingApiKey ? 'Adding...' : 'Add API Key'}
          </button>
        </div>
        {storedApiKeys.length > 0 && (
          <button
            className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-md text-sm hover:bg-green-500/20 transition-colors disabled:opacity-50 cursor-pointer"
            onClick={refreshApiKeysBalances}
            disabled={isRefreshingBalances}
            title="Refresh all API key balances"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshingBalances ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isRefreshingBalances ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        )}
      </div>

      {storedApiKeys.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-white/70 mt-6">{cloudSyncEnabled ? 'Cloud Synced API Keys' : 'Locally Stored API Keys'}</h4>
          {storedApiKeys.map((keyData, index) => {
            const isExpanded = expandedKeys.has(keyData.key);
            const displayUrl = keyData.baseUrl ? keyData.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'No URL';
            return (
              <div key={index} className="bg-white/5 rounded-lg border border-white/10 overflow-hidden">
                {/* Single Line Compact Header */}
                <div
                  className="flex items-center justify-between p-3 hover:bg-white/5 transition-colors cursor-pointer"
                  onClick={() => toggleExpanded(keyData.key)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm font-medium text-white truncate">
                      {keyData.label || 'Unnamed API Key'}
                    </span>
                    <span className="text-xs text-white/50 font-medium text-white truncate">
                      ({displayUrl})
                    </span>
                    {keyData.isInvalid && (
                      <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium rounded-full flex-shrink-0">Invalid</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-medium text-white">
                      {keyData.isInvalid ? 'Invalid' : (keyData.balance !== null ? `${(keyData.balance / 1000).toFixed(2)} sats` : 'N/A')}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(keyData.key);
                      }}
                      className="p-1 hover:bg-white/10 rounded transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-white/70" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-white/70" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Content - Only Visible When Expanded */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-white/10">
                    <div className="flex items-center space-x-2">
                      <input
                        type="password"
                        value={keyData.key}
                        readOnly
                        className="flex-grow bg-black/20 border border-white/10 rounded-md px-3 py-2 text-xs text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-white/20"
                      />
                      <button
                        onClick={() => handleCopyClick(keyData.key)}
                        className="p-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                        title={copiedKey === keyData.key ? "Copied!" : "Copy API Key"}
                      >
                        {copiedKey === keyData.key ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <Copy className="h-4 w-4 text-white/70" />
                        )}
                      </button>
                    </div>
                    <div className="flex justify-end space-x-2">
                      <button
                        className="px-3 py-1 bg-green-500/10 border border-green-500/30 text-green-400 rounded-md text-xs hover:bg-green-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                        onClick={() => handleTopUp(keyData)}
                        disabled={isTopUpLoading === keyData.key || keyData.isInvalid}
                      >
                        {isTopUpLoading === keyData.key ? 'Topping Up...' : 'Top Up'}
                      </button>
                      <button
                        className="px-3 py-1 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-md text-xs hover:bg-blue-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                        onClick={async () => {
                          setIsRefundingKey(keyData.key); // Set loading for this specific key
                          try {
                            const urlToUse = keyData.baseUrl || baseUrl; // Use key-specific baseUrl or fallback to global
                            const refundResult = await unifiedRefund(mintUrl, urlToUse, usingNip60, receiveToken, keyData.key);
                            if (refundResult.success) {
                              toast.success(refundResult.message || 'Refund completed successfully!');
                              refreshApiKeysBalances(); // Refresh balances after successful refund
                            } else {
                              toast.error(refundResult.message || 'Failed to complete refund.');
                            }
                          } catch (error) {
                            console.error('Error during refund:', error);
                            toast.error(`Error during refund: ${error instanceof Error ? error.message : String(error)}`);
                          } finally {
                            setIsRefundingKey(null); // Reset loading
                          }
                        }}
                        disabled={isRefundingKey === keyData.key} // Disable if this key is refunding
                      >
                        {isRefundingKey === keyData.key ? 'Refunding...' : 'Refund'}
                      </button>
                      <button
                        className="px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded-md text-xs hover:bg-red-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                        onClick={() => handleDeleteApiKey(keyData.key)}
                        disabled={isDeletingKey === keyData.key || isSyncingApiKeys} // Disable if this key is deleting or syncing
                      >
                        {isDeletingKey === keyData.key || isSyncingApiKeys ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="pb-20"></div>

      {showConfirmation && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-black rounded-lg p-6 max-w-md w-full border border-white/10">
            {isLoading || isSyncingApiKeys ? (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Creating API Key...</h4>
                <p className="text-sm text-white/70 mb-4">Please wait while your API key is being generated and {cloudSyncEnabled ? 'synced to the cloud' : 'stored locally'}.</p>
                <div className="flex justify-center">
                  <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              </>
            ) : (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Confirm API Key Creation</h4>
                <p className="text-sm text-white/70 mb-4">
                  Note: Your API keys will be stored {cloudSyncEnabled ? 'in the cloud (Nostr) and also cached locally.' : 'only locally. If you clear your local storage, your keys and thus the BALANCE attached to them will be LOST.'}
                </p>
                <div className="flex items-center space-x-2 mb-2">
                  <input
                    type="text"
                    placeholder="API Key Label (optional)"
                    value={newApiKeyLabel}
                    onChange={(e) => setNewApiKeyLabel(e.target.value)}
                    className="flex-grow bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                </div>
                <div className="flex items-center space-x-2 mb-4">
                  <input
                    type="number"
                    placeholder="Amount"
                    value={apiKeyAmount}
                    onChange={(e) => setApiKeyAmount(e.target.value)}
                    className="flex-grow bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                  />
                  <button
                    onClick={() => setApiKeyAmount(localMintBalance.toString())}
                    className="px-3 py-2 bg-white/5 border border-white/20 text-white/70 rounded-md text-sm hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                  >
                    Max
                  </button>
                </div>
                {baseUrls.length > 1 && (
                  <div className="mb-4">
                    <p className="text-sm text-white/70 mb-2">Select Base URL for this API Key:</p>
                    <div className="max-h-32 overflow-y-auto space-y-2">
                      {baseUrls.map((url: string, index: number) => (
                        <div className="flex items-center" key={index}>
                          <input
                            type="radio"
                            id={`newApiKeyBaseUrl-${index}`}
                            name="newApiKeyBaseUrl"
                            className="mr-2 accent-gray-500"
                            checked={selectedNewApiKeyBaseUrl === url}
                            onChange={() => setSelectedNewApiKeyBaseUrl(url)}
                          />
                          <label htmlFor={`newApiKeyBaseUrl-${index}`} className="text-sm text-white">{url}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end space-x-2">
                  <button
                    className="px-4 py-2 bg-transparent text-white/70 hover:text-white rounded-md text-sm transition-colors cursor-pointer"
                    onClick={() => setShowConfirmation(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-md text-sm hover:bg-blue-500/20 transition-colors cursor-pointer"
                    onClick={confirmCreateApiKey}
                  >
                    Confirm
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showDeleteConfirmation && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-black rounded-lg p-6 max-w-md w-full border border-white/10">
            {refundFailed ? (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Refund Failed</h4>
                <p className="text-sm text-white/70 mb-4">
                  ATTENTION! The REFUND operation FAILED. Do you still want to delete this API Key? Any remaining balance will be lost.
                  {cloudSyncEnabled ? ' This will also update your cloud-synced API keys.' : ''}
                </p>
                <div className="flex justify-end space-x-2">
                  <button
                    className="px-4 py-2 bg-transparent text-white/70 hover:text-white rounded-md text-sm transition-colors cursor-pointer"
                    onClick={confirmDeleteApiKey}
                  >
                    Delete Anyway
                  </button>
                  <button
                    className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-md text-sm hover:bg-red-500/20 transition-colors cursor-pointer"
                    onClick={() => {
                      setShowDeleteConfirmation(false);
                      setKeyToDeleteConfirmation(null);
                      setRefundFailed(false);
                      setIsDeletingKey(null);
                    }}
                  >
                    Cancel
                  </button>

                </div>
              </>
            ) : isDeletingKey === keyToDeleteConfirmation || isSyncingApiKeys ? (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Deleting API Key...</h4>
                <p className="text-sm text-white/70 mb-4">Please wait while the API key is being deleted and {cloudSyncEnabled ? 'synced to the cloud and refunded' : 'refunded'}.</p>
                <div className="flex justify-center">
                  <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              </>
            ) : (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Confirm API Key Deletion</h4>
                <p className="text-sm text-white/70 mb-4">
                  Are you sure you want to delete this API Key? This action cannot be undone. Any remaining balance will be refunded.
                  {cloudSyncEnabled ? ' This will also update your cloud-synced API keys.' : ''}
                </p>
                <div className="flex justify-end space-x-2">
                  <button
                    className="px-4 py-2 bg-transparent text-white/70 hover:text-white rounded-md text-sm transition-colors cursor-pointer"
                    onClick={() => {
                      setShowDeleteConfirmation(false);
                      setKeyToDeleteConfirmation(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-md text-sm hover:bg-red-500/20 transition-colors cursor-pointer"
                    onClick={confirmDeleteApiKey}
                  >
                    Confirm Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showTopUpModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-black rounded-lg p-6 max-w-md w-full border border-white/10">
            <h4 className="text-lg font-semibold text-white mb-4">Top Up API Key</h4>
            <p className="text-sm text-white/70 mb-4">
              Top up "{keyToTopUp?.label || 'Unnamed'}" API key with additional sats.
            </p>
            <div className="mb-4">
              <label className="block text-sm text-white/70 mb-2">Amount (sats):</label>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  placeholder="Enter amount"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="flex-grow bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                />
                <button
                  onClick={() => setTopUpAmount(localMintBalance.toString())}
                  className="px-3 py-2 bg-white/5 border border-white/20 text-white/70 rounded-md text-sm hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                >
                  Max
                </button>
              </div>
              <p className="text-xs text-white/50 mt-1">Available: {localMintBalance} sats</p>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                className="px-4 py-2 bg-transparent text-white/70 hover:text-white rounded-md text-sm transition-colors cursor-pointer"
                onClick={() => {
                  setShowTopUpModal(false);
                  setTopUpAmount('');
                  setKeyToTopUp(null);
                }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-md text-sm hover:bg-green-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                onClick={confirmTopUp}
                disabled={!topUpAmount || parseInt(topUpAmount) <= 0 || parseInt(topUpAmount) > localMintBalance}
              >
                Confirm Top Up
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add API Key Modal */}
      {showAddApiKeyModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-black rounded-lg p-6 max-w-md w-full border border-white/10">
            {isAddingApiKey ? (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Adding API Key...</h4>
                <p className="text-sm text-white/70 mb-4">
                  Please wait while your API key is being verified and {cloudSyncEnabled ? 'synced to the cloud' : 'stored locally'}.
                </p>
                <div className="flex justify-center">
                  <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              </>
            ) : (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Add Existing API Key</h4>
                <p className="text-sm text-white/70 mb-4">
                  Add an existing API key to manage it here. The key will be verified before adding.
                </p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-white/70 mb-2">API Key Label (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g., Production Key"
                      value={manualApiKeyLabel}
                      onChange={(e) => setManualApiKeyLabel(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-white/70 mb-2">API Key</label>
                    <input
                      type="text"
                      placeholder="Enter your API key"
                      value={manualApiKey}
                      onChange={(e) => setManualApiKey(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                  </div>

                  {baseUrls.length > 1 && (
                    <div>
                      <label className="block text-sm text-white/70 mb-2">Base URL</label>
                      <div className="max-h-32 overflow-y-auto space-y-2 bg-white/5 rounded-md p-2 border border-white/10">
                        {baseUrls.map((url: string, index: number) => (
                          <div className="flex items-center" key={index}>
                            <input
                              type="radio"
                              id={`manualApiKeyBaseUrl-${index}`}
                              name="manualApiKeyBaseUrl"
                              className="mr-2 accent-gray-500"
                              checked={selectedManualApiKeyBaseUrl === url}
                              onChange={() => setSelectedManualApiKeyBaseUrl(url)}
                            />
                            <label htmlFor={`manualApiKeyBaseUrl-${index}`} className="text-sm text-white">{url}</label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-2 mt-6">
                  <button
                    className="px-4 py-2 bg-transparent text-white/70 hover:text-white rounded-md text-sm transition-colors cursor-pointer"
                    onClick={() => {
                      setShowAddApiKeyModal(false);
                      setManualApiKey('');
                      setManualApiKeyLabel('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-md text-sm hover:bg-blue-500/20 transition-colors cursor-pointer disabled:opacity-50"
                    onClick={confirmAddApiKey}
                    disabled={!manualApiKey.trim()}
                  >
                    Add API Key
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiKeysTab;