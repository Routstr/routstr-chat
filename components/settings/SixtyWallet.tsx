import React, { useState, useEffect } from 'react';
import { AlertCircle } from "lucide-react";
import QRCode from "react-qr-code";
import { getEncodedTokenV4, Proof } from "@cashu/cashu-ts";
import { useCashuWallet } from "@/hooks/useCashuWallet";
import { useCreateCashuWallet } from "@/hooks/useCreateCashuWallet";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCashuToken } from "@/hooks/useCashuToken";
import { useCashuStore } from "@/stores/cashuStore";
import { formatBalance, calculateBalance } from "@/lib/cashu";
import { cn } from "@/lib/utils"; // Import cn for conditional class names

const SixtyWallet: React.FC<{mintUrl:string, usingNip60: boolean, setUsingNip60: (usingNip60: boolean) => void}> = ({mintUrl, usingNip60, setUsingNip60}) => {
  // Popular amounts for quick minting
  const popularAmounts = [100, 500, 1000];
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'deposit' | 'send'>('deposit');

  // Internal state for the UI elements that were previously props
  const [balance, setBalance] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isMinting, setIsMinting] = useState(false);
  const [mintInvoice, setMintInvoice] = useState('');
  const [showInvoiceModal, setShowInvoiceModal] = useState(false); // Renamed to avoid conflict with prop name
  const [isAutoChecking, setIsAutoChecking] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isGeneratingSendToken, setIsGeneratingSendToken] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Handle quick mint button click
  const handleQuickMint = async (amount: number) => {
    setMintAmount(amount.toString());
    // Simulate async operation
    setIsMinting(true);
    setTimeout(() => {
      setMintInvoice(`lnbc...${Math.random().toString(36).substring(7)}`); // Simulate invoice generation
      setIsMinting(false);
    }, 1000);
  };

  const createMintQuote = async () => {
    setIsMinting(true);
    setTimeout(() => {
      setMintInvoice(`lnbc...${Math.random().toString(36).substring(7)}`);
      setIsMinting(false);
    }, 1000);
  };

  const { user } = useCurrentUser();
  const { wallet, isLoading } = useCashuWallet();
  const { mutate: handleCreateWallet, isPending: isCreatingWallet, error: createWalletError } = useCreateCashuWallet();
  const cashuStore = useCashuStore();
  const { sendToken, receiveToken, cleanSpentProofs, isLoading: isTokenLoading, error: hookError } = useCashuToken();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mintAmount, setMintAmount] = useState(''); // For deposit via lightning (not used in final)
  const [generatedToken, setGeneratedToken] = useState(''); // For send
  const [tokenToImport, setTokenToImport] = useState(''); // For receive
  const [sendAmount, setSendAmount] = useState(''); // For send

  useEffect(() => {
    if (createWalletError) {
      setError(createWalletError.message);
      console.log(createWalletError.message);
    }
  }, [createWalletError]);

  useEffect(() => {
    if (hookError) {
      setError(hookError);
    }
  }, [hookError]);

  const mintBalances = React.useMemo(() => {
    if (!cashuStore.proofs) return {};
    return calculateBalance(cashuStore.proofs);
  }, [cashuStore.proofs]);

  useEffect(() => {
    const totalBalance = Object.values(mintBalances).reduce(
      (sum, balance) => sum + balance,
      0
    );
    setBalance(totalBalance);
  }, [mintBalances]);

  const cleanMintUrl = (mintUrl: string) => {
    try {
      const url = new URL(mintUrl);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return mintUrl;
    }
  };

  const handleReceiveToken = async () => {
    if (!tokenToImport) {
      setError("Please enter a token");
      return;
    }

   try {
      setError(null);
      setSuccessMessage(null);

      const proofs = await receiveToken(tokenToImport);
      const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);

      setSuccessMessage(`Received ${formatBalance(totalAmount)} successfully!`);
      setTokenToImport("");
    } catch (error) {
      console.error("Error receiving token:", error);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const handlesendToken = async () => {
    if (!cashuStore.activeMintUrl) {
      setError(
        "No active mint selected. Please select a mint in your wallet settings."
      );
      return;
    }

    if (!sendAmount || isNaN(parseInt(sendAmount))) {
      setError("Please enter a valid amount");
      return;
    }

    try {
      setError(null);
      setSuccessMessage(null);
      setGeneratedToken("");

      const amountValue = parseInt(sendAmount);
      const proofs = await sendToken(cashuStore.activeMintUrl, amountValue);
      const token = getEncodedTokenV4({
        mint: cashuStore.activeMintUrl,
        proofs: proofs.map((p) => ({
          id: p.id || "",
          amount: p.amount,
          secret: p.secret || "",
          C: p.C || "",
        })),
      });

      setGeneratedToken(token as string);
      setSuccessMessage(`Token generated for ${formatBalance(amountValue)}`);
    } catch (error) {
      console.error("Error generating token:", error);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const copyTokenToClipboard = () => {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
      setSuccessMessage("Token copied to clipboard");
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  if (isLoading || isCreatingWallet) {
    return (
      <div className="space-y-6">
        <div className="bg-white/5 border border-white/10 rounded-md p-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/70">Loading wallet...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="space-y-6">
        <div className="bg-white/5 border border-white/10 rounded-md p-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/70">You don't have a Cashu wallet yet</span>
          </div>
          <div className="mt-4">
            <button
              onClick={() => handleCreateWallet()}
              disabled={!user}
              className="bg-white/10 border border-white/10 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
              type="button"
            >
              Create Wallet
            </button>
            {!user && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-3 rounded-md text-sm mt-4">
                <div className="flex items-center">
                  <AlertCircle className="h-4 w-4 mr-2" />
                  <span>
                    You need to log in to create a wallet
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Display */}
      <div className="bg-white/5 border border-white/10 rounded-md p-4">
        <div className="flex justify-between items-center">
          <span className="text-sm text-white/70">Available Balance</span>
          <div className="flex flex-col items-end">
            <span className="text-lg font-semibold text-white">{balance} sats</span>
          </div>
        </div>
        {wallet.mints && wallet.mints.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <h3 className="text-sm font-medium text-white/80 mb-2">Select Mint</h3>
            <div className="space-y-2">
              {wallet.mints.map((mint) => {
                const mintBalance = mintBalances[mint] || 0;
                const isActive = cashuStore.activeMintUrl === mint;
                return (
                  <div key={mint} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <input
                        type="radio"
                        id={`mint-${mint}`}
                        name="activeMint"
                        value={mint}
                        checked={isActive}
                        onChange={() => cashuStore.setActiveMintUrl(mint)}
                        className="form-radio h-4 w-4 text-white bg-white/10 border-white/30 focus:ring-white/50"
                      />
                      <label htmlFor={`mint-${mint}`} className={cn("ml-2 text-sm cursor-pointer", isActive ? "text-white" : "text-white/70")}>
                        {cleanMintUrl(mint)}
                      </label>
                      <button
                        onClick={() => cleanSpentProofs(mint)}
                        className="ml-2 px-2 py-1 text-xs bg-white/10 border border-white/20 rounded-md text-white hover:bg-white/20 transition-colors"
                        type="button"
                      >
                        Clean Proofs
                      </button>
                    </div>
                    <span className={cn("text-sm font-medium", isActive ? "text-white" : "text-white/70")}>
                      {formatBalance(mintBalance)} sats
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      
      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-3 rounded-md text-sm">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-200 p-3 rounded-md text-sm">
          {successMessage}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-white/5 border border-white/10 rounded-md">
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'deposit'
                ? 'text-white bg-white/5 border-b-2 border-white/30'
                : 'text-white/70 hover:text-white/90 hover:bg-white/5'
            }`}
            type="button"
          >
            Deposit
          </button>
          <button
            onClick={() => setActiveTab('send')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'send'
                ? 'text-white bg-white/5 border-b-2 border-white/30'
                : 'text-white/70 hover:text-white/90 hover:bg-white/5'
            }`}
            type="button"
          >
            Send
          </button>
        </div>

        {/* Tab Content Container with Fixed Height */}
        <div className="p-4 min-h-[400px]">
          {/* Deposit Tab Content */}
          {activeTab === 'deposit' && (
            <div className="space-y-6 h-full">
              {/* Mint Tokens Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Via Lightning</h3>

                {/* Quick Mint Buttons */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    {popularAmounts.map((amount) => (
                      <button
                        key={amount}
                        onClick={() => handleQuickMint(amount)}
                        disabled={isMinting}
                        className="flex-1 bg-white/5 border border-white/20 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 hover:border-white/30 transition-colors disabled:opacity-50 cursor-pointer"
                        type="button"
                      >
                        {amount} sats
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual Amount Input */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={mintAmount}
                      onChange={(e) => setMintAmount(e.target.value)}
                      className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                      placeholder="Amount in sats"
                    />
                    <button
                      onClick={createMintQuote}
                      disabled={isMinting || !mintAmount}
                      className="bg-white/10 border border-white/10 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                      type="button"
                    >
                      {isMinting ? 'Generating...' : 'Generate Invoice'}
                    </button>
                  </div>
                </div>

                {mintInvoice && (
                  <div className="bg-white/5 border border-white/10 rounded-md p-4">
                    <div className="mb-2 flex justify-between items-center">
                      <span className="text-sm text-white/70">Lightning Invoice</span>
                      <button
                        onClick={() => setShowInvoiceModal(true)}
                        className="text-xs text-blue-300 hover:text-blue-200 cursor-pointer"
                        type="button"
                      >
                        Show QR Code
                      </button>
                    </div>
                    {isAutoChecking && (
                      <div className="mb-2 bg-yellow-500/10 border border-yellow-500/30 rounded-md p-2 flex items-center justify-between">
                        <span className="text-xs text-yellow-200/80">After payment, tokens will be automatically minted</span>
                        <span className="text-xs text-yellow-200/80 flex items-center">
                          {countdown}s
                          <svg className="ml-2 w-3 h-3 animate-spin" viewBox="0 0 24 24">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"
                               stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                          </svg>
                        </span>
                      </div>
                    )}
                    <div className="font-mono text-xs break-all text-white/70">
                      {mintInvoice}
                    </div>
                  </div>
                )}
              </div>

              {/* Import Tokens Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Via Cashu</h3>
                <div className="space-y-2">
                  <textarea
                    value={tokenToImport}
                    onChange={(e) => setTokenToImport(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white h-24 focus:border-white/30 focus:outline-none resize-none"
                    placeholder="Paste your Cashu token here..."
                  />
                  <button
                    onClick={handleReceiveToken}
                    disabled={isImporting || !tokenToImport.trim()}
                    className="w-full bg-white/10 border border-white/10 text-white py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                    type="button"
                  >
                    {isImporting ? 'Importing...' : 'Import Token'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Send Tab Content */}
          {activeTab === 'send' && (
            <div className="space-y-6 h-full">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Send eCash</h3>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                    placeholder="Amount in sats"
                  />
                  <button
                    onClick={handlesendToken}
                    disabled={isGeneratingSendToken || !sendAmount || parseInt(sendAmount) > balance}
                    className="bg-white/10 border border-white/10 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors disabled:opacity-50 cursor-pointer"
                    type="button"
                  >
                    {isGeneratingSendToken ? 'Generating...' : 'Generate Token'}
                  </button>
                </div>

                {generatedToken && (
                  <div className="bg-white/5 border border-white/10 rounded-md p-4">
                    <div className="mb-2 flex justify-between items-center">
                      <span className="text-sm text-white/70">Generated Token</span>
                      <button
                        onClick={() => {
                          try {
                            void navigator.clipboard.writeText(generatedToken);
                            // setSuccessMessage('Token copied to clipboard!'); // This will be handled by parent
                            // setTimeout(() => setSuccessMessage(''), 3000);
                          } catch {
                            // setError('Failed to copy token to clipboard'); // This will be handled by parent
                          }
                        }}
                        className="text-xs text-blue-300 hover:text-blue-200 cursor-pointer"
                        type="button"
                      >
                        Copy Token
                      </button>
                    </div>
                    <div className="font-mono text-xs break-all text-white/70 max-h-32 overflow-y-auto">
                      {generatedToken}
                    </div>
                  </div>
                )}
              </div>

              {/* Additional spacing to match deposit tab height */}
              <div className="space-y-4">
                <div className="text-sm text-white/50 italic">
                  Share your generated token with others to send them eCash.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SixtyWallet;