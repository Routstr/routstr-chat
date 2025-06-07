'use client';

import { useState, useEffect } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { getBalanceFromStoredProofs, generateApiToken } from '@/utils/cashuUtils';
import { toast } from 'sonner';

interface StoredApiKey {
  key: string;
  balance: number;
}

interface ApiKeysTabProps {
  balance: number;
  mintUrl: string;
  baseUrl: string;
}

const ApiKeysTab = ({ balance, mintUrl, baseUrl }: ApiKeysTabProps) => {
  const [currentApiKey, setCurrentApiKey] = useState<string | null>(null);
  const [showCurrentApiKey, setShowCurrentApiKey] = useState(false);
  const [proofsBalance, setProofsBalance] = useState(0);
  const [apiKeyAmount, setApiKeyAmount] = useState('');
  const [storedApiKeys, setStoredApiKeys] = useState<StoredApiKey[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    const storedApiKey = localStorage.getItem('current_api_key');
    setCurrentApiKey(storedApiKey);
    setProofsBalance(getBalanceFromStoredProofs());
    const storedKeys = localStorage.getItem('api_keys');
    if (storedKeys) {
      setStoredApiKeys(JSON.parse(storedKeys));
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
    setShowConfirmation(false);
    try {
      // Assuming mintUrl is available from a parent component or context
      // For now, using a placeholder. This needs to be passed down.
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

        const newStoredKey: StoredApiKey = { key: newApiKey, balance: parseInt(newApiKeyBalance) };
        const updatedKeys = [...storedApiKeys, newStoredKey];
        localStorage.setItem('api_keys', JSON.stringify(updatedKeys));
        setStoredApiKeys(updatedKeys);
        setApiKeyAmount('');
        alert('API Key created and stored successfully!');
      } else {
        alert('Failed to generate Cashu token for API key creation.');
      }
    } catch (error) {
      console.error('Error creating API key:', error);
      alert(`Error creating API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const apiBalance = balance - proofsBalance;

  const refreshApiKeysBalances = async () => {
    const updatedKeys: StoredApiKey[] = [];
    for (const keyData of storedApiKeys) {
      try {
        const response = await fetch(`${baseUrl}v1/wallet/info`, {
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
    alert('API Key balances refreshed!');
  };

  return (
    <div className="space-y-4 text-white">
      <h3 className="text-lg font-semibold">API Keys</h3>

      <div className="bg-white/5 rounded-lg p-4 border border-white/10">
        <p className="text-sm text-white/70">Current Balance:</p>
        <p className="text-lg font-medium mb-4">{Number(apiBalance).toFixed(3)} sats</p>

        <p className="text-sm text-white/70">Your Chat API Key:</p>
        <div className="flex items-center space-x-2 mt-2">
          <input
            type={showCurrentApiKey ? 'text' : 'password'}
            value={currentApiKey || 'No API Key found'}
            readOnly
            className="flex-grow bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
          />
          <button
            onClick={() => setShowCurrentApiKey(!showCurrentApiKey)}
            className="p-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
            title={showCurrentApiKey ? 'Hide API Key' : 'Show API Key'}
          >
            {showCurrentApiKey ? <EyeOff className="h-5 w-5 text-white/70" /> : <Eye className="h-5 w-5 text-white/70" />}
          </button>
          <button
            onClick={() => handleCopyClick(currentApiKey || '')}
            className="p-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
            title="Copy API Key"
          >
            <Copy className="h-5 w-5 text-white/70" />
          </button>
        </div>
      </div>

      <div>
        <p className="text-sm text-white/70">Available in Wallet:</p>
        <p className="text-lg font-medium">{proofsBalance} sats</p>
      </div>

      <div className="bg-white/5 rounded-lg p-4 border border-white/10">
        <p className="text-sm text-white/70 mb-2">Create New API Key:</p>
        <div className="flex items-center space-x-2 mb-4">
          <input
            type="number"
            placeholder="Amount"
            value={apiKeyAmount}
            onChange={(e) => setApiKeyAmount(e.target.value)}
            className="flex-grow bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
          />
          <button
            onClick={() => setApiKeyAmount(proofsBalance.toString())}
            className="px-3 py-2 bg-white/10 text-white rounded-md text-sm hover:bg-white/20 transition-colors"
          >
            Max
          </button>
        </div>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
          onClick={createApiKey}
        >
          Create API Key
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
              <p className="text-sm text-white/70">Balance: {Number(keyData.balance/1000)} sats</p>
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
            </div>
          ))}
        </div>
      )}

      {showConfirmation && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-black rounded-lg p-6 max-w-md w-full border border-white/10">
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
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiKeysTab;