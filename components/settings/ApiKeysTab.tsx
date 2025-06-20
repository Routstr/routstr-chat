'use client';

import { useState, useEffect } from 'react';
import { Copy, Eye, EyeOff, Info } from 'lucide-react';
import { getBalanceFromStoredProofs, refundRemainingBalance, create60CashuToken, generateApiToken, unifiedRefund } from '@/utils/cashuUtils';
import { toast } from 'sonner';
import { useApiKeysSync } from '@/hooks/useApiKeysSync'; // Import the new hook
import { useCurrentUser } from '@/hooks/useCurrentUser'; // For checking user login
import { useCashuStore } from '@/stores/cashuStore';
import { useCashuToken } from '@/hooks/useCashuToken';

export interface StoredApiKey {
  key: string;
  balance: number | null; // Changed to accept null for invalid keys
  label?: string; // Added optional label field
  baseUrl?: string; // Added optional baseUrl field
  isInvalid?: boolean; // New field to mark invalid keys
}

interface ApiKeysTabProps {
  balance: number;
  setBalance: (balance: number | ((prevBalance: number) => number)) => void;
  mintUrl: string;
  baseUrl: string;
  usingNip60: boolean;
}

const ApiKeysTab = ({ balance, setBalance, mintUrl, baseUrl, usingNip60 }: ApiKeysTabProps) => {
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

  const [showTooltip, setShowTooltip] = useState(false); // New state for tooltip visibility
  const [apiKeyAmount, setApiKeyAmount] = useState('');
  const [storedApiKeys, setStoredApiKeys] = useState<StoredApiKey[]>([]); // This will now primarily represent the active keys
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // Added isLoading state (for minting, not sync)
  const [isRefundingKey, setIsRefundingKey] = useState<string | null>(null); // New state for refund loading
  const [isDeletingKey, setIsDeletingKey] = useState<string | null>(null); // New state for delete loading
  const [newApiKeyLabel, setNewApiKeyLabel] = useState(''); // Added state for new API key label
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false); // New state for delete confirmation modal
  const [keyToDeleteConfirmation, setKeyToDeleteConfirmation] = useState<string | null>(null); // Key to delete in confirmation modal

  // Effect to manage API keys based on cloud sync setting
  useEffect(() => {
    if (cloudSyncEnabled && user) {
      // Use functional update to avoid issues if syncedApiKeys reference changes but content is same
      setStoredApiKeys(prevKeys => {
        // Simple reference equality check. Assume syncedApiKeys itself is stable/memoized.
        if (prevKeys === syncedApiKeys) return prevKeys; 
        return syncedApiKeys;
      });

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
  }, [cloudSyncEnabled, user, syncedApiKeys, createOrUpdateApiKeys, baseUrl]); // Added baseUrl to dependencies

  const handleCopyClick = async (keyToCopy: string) => {
    if (keyToCopy) {
      try {
        await navigator.clipboard.writeText(keyToCopy);
        toast.success('Copied!');
      } catch (err) {
        toast.error('Failed to copy!');
      }
    }
  };

  const createApiKey = async () => {
    if (!apiKeyAmount || parseInt(apiKeyAmount) <= 0) {
      alert('Please enter a valid amount for the API key.');
      return;
    }

    setShowConfirmation(true);
  };

  const confirmCreateApiKey = async () => {
    setIsLoading(true); // Set loading to true
    try {
      let token: string | null | { hasTokens: false } | undefined;
      
      if (usingNip60) {
        if (!cashuStore.activeMintUrl) {
          toast.error('No active mint selected');
          return;
        }
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

      const response = await fetch(`${baseUrl}v1/wallet/info`, {
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

      const newStoredKey: StoredApiKey = { key: newApiKey, balance: parseInt(newApiKeyBalance), label: newApiKeyLabel || 'Unnamed', baseUrl: baseUrl, isInvalid: false }; // Include label, baseUrl, and isInvalid
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
      setBalance(balance - parseInt(apiKeyAmount));
    } catch (error) {
      console.error('Error creating API key:', error);
      toast.error(`Error creating API key: ${error instanceof Error ? error.message : String(error)}`); // Use toast
    } finally {
      setIsLoading(false); // Set loading to false
      setShowConfirmation(false); // Close confirmation modal after loading is complete
    }
  };

  const refreshApiKeysBalances = async () => {
    const updatedKeys: StoredApiKey[] = [];
    for (const keyData of storedApiKeys) {
      try {
        const urlToUse = keyData.baseUrl || baseUrl; // Use key-specific baseUrl or fallback to global
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
        updatedKeys.push(keyData); // Keep old data if error occurs
      }
    }
    // Update local storage if not cloud syncing, otherwise the hook will handle it
    if (!cloudSyncEnabled) {
      localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
    }
    setStoredApiKeys(updatedKeys);
    toast.success('API Key balances refreshed!');
  };

  const handleDeleteApiKey = (keyToDelete: string) => {
    setKeyToDeleteConfirmation(keyToDelete);
    setShowDeleteConfirmation(true);
  };

  const confirmDeleteApiKey = async () => {
    if (!keyToDeleteConfirmation) return;

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
          setBalance(balance-(refundResult.refundedAmount??0))
        } else {
          toast.error(refundResult.message || 'Failed to refund API Key balance. Deleting key anyway.');
        }
      }
      
      const updatedKeys = storedApiKeys.filter(keyData => keyData.key !== keyToDeleteConfirmation);
      
      if (cloudSyncEnabled) {
        await deleteApiKey(keyToDeleteConfirmation); // The hook handles updating the cloud
        toast.success('API Key deleted and synced to cloud successfully!');
      } else {
        localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
        toast.success('API Key deleted locally!');
      }

      setStoredApiKeys(updatedKeys);
    } catch (error) {
      console.error('Error deleting API key:', error);
      toast.error(`Error deleting API key: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeletingKey(null); // Reset loading
      setKeyToDeleteConfirmation(null); // Clear the key to delete
    }
  };
 
  return (
    <div className="space-y-4 text-white relative"> {/* Added relative positioning back */}
      <h3 className="text-lg font-semibold">API Keys</h3>

      {user && ( // Only show cloud sync option if user is logged in
        <div className="mb-4 md:absolute md:top-4 md:right-4 md:mb-0 z-10"> {/* Responsive positioning */}
          <div className="bg-white/5 rounded-lg p-3 border border-white/10 flex items-center shadow-lg">
            <label htmlFor="cloud-sync-toggle" className="text-sm font-medium text-white/70 mr-2 flex items-center cursor-pointer" onClick={() => setShowTooltip(!showTooltip)}>
              Sync with Cloud (Nostr)
              <div
                className="relative inline-block ml-2" // Removed 'group' class
                
                onMouseEnter={() => setShowTooltip(true)} // Keep hover for desktop
                onMouseLeave={() => setShowTooltip(false)} // Keep hover for desktop
              >
                <Info className="h-4 w-4 text-white/60 hover:text-white transition-colors cursor-pointer" /> {/* Added cursor-pointer */}
                {/* Tooltip */}
                <div
                  className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 bg-gray-800 text-white text-xs rounded-md shadow-lg transition-opacity duration-300 w-64 border border-gray-700 whitespace-normal ${
                    showTooltip ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <p>API keys are synced with Nostr using <span className="font-semibold">NIP-78</span> (Kind 30078) for addressable replaceable events.</p>
                  <p className="mt-1">Data is encrypted using <span className="font-semibold">NIP-44</span> for enhanced security and privacy.</p>
                </div>
              </div>
            </label>
            {/* Custom Toggle Switch */}
            <button
              role="switch"
              aria-checked={cloudSyncEnabled}
              onClick={() => setCloudSyncEnabled(!cloudSyncEnabled)}
              className={`${
                cloudSyncEnabled ? 'bg-blue-600' : 'bg-gray-400'
              } relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
            >
              <span
                className={`${
                  cloudSyncEnabled ? 'translate-x-6' : 'translate-x-1'
                } inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300`}
              />
            </button>
          </div>
        </div>
      )}

      <div>
        <p className="text-sm text-white/70">Available in Wallet:</p>
        <p className="text-lg font-medium">{balance} sats</p>
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

      <div className="bg-white/5 rounded-lg p-4 border border-white/10">
        <p className="text-sm text-white/70 mb-2">Create New API Key:</p>
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
            onClick={() => setApiKeyAmount(balance.toString())}
            className="px-3 py-2 bg-white/10 text-white rounded-md text-sm hover:bg-white/20 transition-colors"
          >
            Max
          </button>
        </div>
        <button
          className="px-4 py-2 bg-white/10 border border-white/10 text-white rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
          onClick={createApiKey}
          disabled={isLoading || isSyncingApiKeys} // Disable button when loading or syncing
        >
          {isLoading ? 'Creating...' : 'Create API Key'} {/* Change button text when loading */}
        </button>
      </div>

      {storedApiKeys.length > 0 && (
        <div className="space-y-2">          
          <div className="flex justify-between items-center mt-4">
            <h4 className="text-md font-semibold">{cloudSyncEnabled ? 'Cloud Synced API Keys:' : 'Locally Stored API Keys:'}</h4>
            <button
              className="px-3 py-1 bg-white/10 text-white rounded-md text-xs hover:bg-white/20 transition-colors"
              onClick={refreshApiKeysBalances}
            >
              Refresh Balances
            </button>
          </div>
          {storedApiKeys.map((keyData, index) => (
            <div key={index} className="bg-white/5 rounded-lg p-3 border border-white/10">
              <div className="flex justify-between items-center">
                <p className="text-sm text-white/70">Label: {keyData.label || 'Unnamed'}</p> {/* Display label */}
                <p className="text-md text-white">
                  Balance: {keyData.isInvalid ? 'Invalid' : (keyData.balance !== null ? `${Number(keyData.balance / 1000)} sats` : 'N/A')}
                  {keyData.isInvalid && (
                    <span className="ml-2 px-2 py-1 bg-red-600 text-white text-xs font-semibold rounded-full">Invalid</span>
                  )}
                </p>
              </div>
              <p className="text-sm text-white/70">Base URL: {keyData.baseUrl || 'Unset'}</p>
              <div className="flex items-center space-x-2 mt-1">
                <input
                  type="password" // Always hide stored keys by default
                  value={keyData.key}
                  readOnly
                  className="flex-grow bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                />
                {/* For simplicity, not adding individual show/hide for each stored key, but it can be added */}
                <button
                  onClick={() => handleCopyClick(keyData.key)}
                  className="p-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
                  title="Copy API Key"
                >
                  <Copy className="h-5 w-5 text-white/70" />
                </button>
              </div>
              <div className="flex justify-end space-x-2 mt-2">
                <button
                  className="px-3 py-1 bg-green-600 text-white rounded-md text-xs hover:bg-green-700 transition-colors"
                  onClick={() => toast.info('Top Up functionality coming soon!')} // Placeholder
                >
                  Top Up
                </button>
                <button
                  className="px-3 py-1 bg-blue-600 text-white rounded-md text-xs hover:bg-blue-700 transition-colors"
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
                  className="px-3 py-1 bg-red-800 text-white rounded-md text-xs hover:bg-red-900 transition-colors"
                  onClick={() => handleDeleteApiKey(keyData.key)}
                  disabled={isDeletingKey === keyData.key || isSyncingApiKeys} // Disable if this key is deleting or syncing
                >
                  {isDeletingKey === keyData.key || isSyncingApiKeys ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
                <div className="flex justify-end space-x-2">
                  <button
                    className="px-4 py-2 bg-transparent text-white/70 hover:text-white rounded-md text-sm transition-colors"
                    onClick={() => setShowConfirmation(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
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
            {isDeletingKey === keyToDeleteConfirmation || isSyncingApiKeys ? (
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
                    className="px-4 py-2 bg-transparent text-white/70 hover:text-white rounded-md text-sm transition-colors"
                    onClick={() => {
                      setShowDeleteConfirmation(false);
                      setKeyToDeleteConfirmation(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-colors"
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
    </div>
  );
};

export default ApiKeysTab;