'use client';

import { useState, useEffect } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { getBalanceFromStoredProofs, generateApiToken, refundRemainingBalance } from '@/utils/cashuUtils';
import { toast } from 'sonner';

interface StoredApiKey {
  key: string;
  balance: number;
  label?: string; // Added optional label field
  baseUrl?: string; // Added optional baseUrl field
}

interface ApiKeysTabProps {
  balance: number;
  setBalance: (balance: number | ((prevBalance: number) => number)) => void;
  mintUrl: string;
  baseUrl: string;
}

const ApiKeysTab = ({ balance, setBalance, mintUrl, baseUrl }: ApiKeysTabProps) => {
  const [apiKeyAmount, setApiKeyAmount] = useState('');
  const [storedApiKeys, setStoredApiKeys] = useState<StoredApiKey[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // Added isLoading state
  const [isRefundingKey, setIsRefundingKey] = useState<string | null>(null); // New state for refund loading
  const [isDeletingKey, setIsDeletingKey] = useState<string | null>(null); // New state for delete loading
  const [newApiKeyLabel, setNewApiKeyLabel] = useState(''); // Added state for new API key label
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false); // New state for delete confirmation modal
  const [keyToDeleteConfirmation, setKeyToDeleteConfirmation] = useState<string | null>(null); // Key to delete in confirmation modal

  useEffect(() => {
    const storedKeys = localStorage.getItem('api_keys');
    if (storedKeys) {
      const parsedKeys: StoredApiKey[] = JSON.parse(storedKeys);
      // Ensure old keys have a name and baseUrl field, default to 'Unnamed' and current baseUrl
      const keysWithNamesAndBaseUrl = parsedKeys.map(key => ({ ...key, label: key.label || 'Unnamed', baseUrl: key.baseUrl || baseUrl }));
      setStoredApiKeys(keysWithNamesAndBaseUrl);
    }
  }, []);

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
      const token = await generateApiToken(mintUrl, parseInt(apiKeyAmount));

      if (token) {
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

        const newStoredKey: StoredApiKey = { key: newApiKey, balance: parseInt(newApiKeyBalance), label: newApiKeyLabel || 'Unnamed', baseUrl: baseUrl }; // Include label and baseUrl
        const updatedKeys = [...storedApiKeys, newStoredKey];
        localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
        setStoredApiKeys(updatedKeys);
        setApiKeyAmount('');
        setNewApiKeyLabel(''); // Clear label input
        setBalance(getBalanceFromStoredProofs())
        toast.success('API Key created and stored successfully!'); // Use toast
      } else {
        toast.error('Failed to generate Cashu token for API key creation.'); // Use toast
      }
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
          console.error(`Failed to refresh balance for key ${keyData.key}:`, response.statusText);
          updatedKeys.push(keyData); // Keep old data if refresh fails
          continue;
        }

        const data = await response.json();
        updatedKeys.push({ ...keyData, balance: data.balance });
      } catch (error) {
        console.error(`Error refreshing balance for key ${keyData.key}:`, error);
        updatedKeys.push(keyData); // Keep old data if error occurs
      }
    }
    localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
    setStoredApiKeys(updatedKeys);
    setBalance(getBalanceFromStoredProofs());
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
        const refundResult = await refundRemainingBalance(mintUrl, urlToUse, keyDataToDelete.key);

        if (refundResult.success) {
          toast.success(refundResult.message || 'API Key balance refunded successfully!');
        } else {
          toast.error(refundResult.message || 'Failed to refund API Key balance. Deleting key anyway.');
        }
      }

      const updatedKeys = storedApiKeys.filter(keyData => keyData.key !== keyToDeleteConfirmation);
      localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
      setStoredApiKeys(updatedKeys);
      setBalance(getBalanceFromStoredProofs());
      toast.success('API Key deleted successfully!');
    } catch (error) {
      console.error('Error deleting API key:', error);
      toast.error(`Error deleting API key: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeletingKey(null); // Reset loading
      setKeyToDeleteConfirmation(null); // Clear the key to delete
    }
  };
 
  return (
    <div className="space-y-4 text-white">
      <h3 className="text-lg font-semibold">API Keys</h3>
      <div>
        <p className="text-sm text-white/70">Available in Wallet:</p>
        <p className="text-lg font-medium">{balance} sats</p>
      </div>

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
          disabled={isLoading} // Disable button when loading
        >
          {isLoading ? 'Creating...' : 'Create API Key'} {/* Change button text when loading */}
        </button>
      </div>

      {storedApiKeys.length > 0 && (
        <div className="space-y-2">          
          <div className="flex justify-between items-center mt-4">
            <h4 className="text-md font-semibold">Locally Stored API Keys:</h4>
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
                <p className="text-md text-white">Balance: {Number(keyData.balance/1000)} sats</p>
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
                      const result = await refundRemainingBalance(mintUrl, urlToUse, keyData.key);
                      if (result.success) {
                        toast.success(result.message || 'Refund completed successfully!');
                        refreshApiKeysBalances(); // Refresh balances after successful refund
                      } else {
                        toast.error(result.message || 'Failed to complete refund.');
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
                  disabled={isDeletingKey === keyData.key} // Disable if this key is deleting
                >
                  {isDeletingKey === keyData.key ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showConfirmation && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-black rounded-lg p-6 max-w-md w-full border border-white/10">
            {isLoading ? (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Creating API Key...</h4>
                <p className="text-sm text-white/70 mb-4">Please wait while your API key is being generated and stored.</p>
                {/* You can add a spinner here if you have one */}
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
                  Note: Your API keys will only be stored locally. If you clear your local storage, your keys and thus the BALANCE attached to them will be LOST.
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
            {isDeletingKey === keyToDeleteConfirmation ? (
              <>
                <h4 className="text-lg font-semibold text-white mb-4">Deleting API Key...</h4>
                <p className="text-sm text-white/70 mb-4">Please wait while the API key is being deleted and refunded.</p>
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