import React, { useState, useEffect, useCallback } from 'react';
import { useWalletOperations } from '@/hooks/useWalletOperations';
import { TransactionHistory } from '@/types/chat';
import { MintQuoteState } from '@cashu/cashu-ts';
import InvoiceModal from './InvoiceModal';
import InvoiceHistory from './InvoiceHistory';

// Types for Cashu
interface MintQuoteResponse {
  quote: string;
  request?: string;
  state: MintQuoteState;
  expiry?: number;
}

interface WalletTabProps {
  balance: number;
  setBalance: (balance: number | ((prevBalance: number) => number)) => void;
  mintUrl: string;
  baseUrl: string;
  transactionHistory: TransactionHistory[];
  setTransactionHistory: (transactionHistory: TransactionHistory[] | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])) => void;
}

const WalletTab: React.FC<WalletTabProps> = ({
  balance,
  setBalance,
  mintUrl,
  baseUrl,
  transactionHistory,
  setTransactionHistory,
}) => {
  // Local state for the component
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [mintAmount, setMintAmount] = useState('');
  const [mintInvoice, setMintInvoice] = useState('');
  const [mintQuote, setMintQuote] = useState<MintQuoteResponse | null>(null);
  const [isMinting, setIsMinting] = useState(false);
  const [isAutoChecking, setIsAutoChecking] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [sendAmount, setSendAmount] = useState('');
  const [isGeneratingSendToken, setIsGeneratingSendToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState('');
  const [tokenToImport, setTokenToImport] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // Use wallet operations hook
  const {
    initWallet,
    checkMintQuote: hookCheckMintQuote,
    createMintQuote: hookCreateMintQuote,
    importToken: hookImportToken,
    generateSendToken: hookGenerateSendToken,
    setupAutoRefresh,
    checkIntervalRef,
    countdownIntervalRef
  } = useWalletOperations({
    mintUrl,
    baseUrl,
    setBalance,
    setTransactionHistory,
    transactionHistory
  });

  // Wrapper functions to call hook functions with proper parameters
  const checkMintQuote = useCallback(async () => {
    await hookCheckMintQuote(
      isAutoChecking,
      setIsAutoChecking,
      mintAmount,
      setError,
      setSuccessMessage,
      setShowInvoiceModal,
      setMintQuote,
      setMintInvoice,
      countdown,
      setCountdown
    );
  }, [hookCheckMintQuote, isAutoChecking, mintAmount]);

  const createMintQuote = async (amountOverride?: number) => {
    await hookCreateMintQuote(
      setIsMinting,
      setError,
      setSuccessMessage,
      setShowInvoiceModal,
      mintAmount,
      setMintQuote,
      setMintInvoice,
      amountOverride
    );
  };

  const importToken = async () => {
    await hookImportToken(
      setIsImporting,
      setError,
      setSuccessMessage,
      tokenToImport,
      setTokenToImport
    );
  };

  const generateSendToken = async () => {
    await hookGenerateSendToken(
      setIsGeneratingSendToken,
      setError,
      setSuccessMessage,
      sendAmount,
      balance,
      setSendAmount,
      setGeneratedToken
    );
  };

  // Initialize wallet when component mounts or mintUrl changes
  useEffect(() => {
    const initializeWallet = async () => {
      try {
        await initWallet();
      } catch (error) {
        setError('Failed to initialize wallet. Please try again.');
      }
    };

    void initializeWallet();
  }, [mintUrl, initWallet]);

  // Set up auto-refresh interval when invoice is generated
  useEffect(() => {
    const cleanup = setupAutoRefresh(
      mintInvoice,
      mintQuote,
      checkMintQuote,
      isAutoChecking,
      setIsAutoChecking,
      countdown,
      setCountdown
    );

    return cleanup;
  }, [mintInvoice, mintQuote, checkMintQuote, isAutoChecking, setupAutoRefresh]);

  // Popular amounts for quick minting
  const popularAmounts = [100, 500, 1000];
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'deposit' | 'send' | 'history'>('deposit');

  // Handle quick mint button click
  const handleQuickMint = async (amount: number) => {
    setMintAmount(amount.toString());
    // Pass amount directly to avoid state update race condition
    await createMintQuote(amount);
  };

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
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-500/5 border border-red-500/20 text-red-400 p-3 rounded-md text-sm">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-500/5 border border-green-500/20 text-green-400 p-3 rounded-md text-sm">
          {successMessage}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-white/5 border border-white/10 rounded-md">
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'deposit'
                ? 'text-white bg-white/5 border-b-2 border-white'
                : 'text-white/70 hover:text-white/90 hover:bg-white/5'
            }`}
            type="button"
          >
            Deposit
          </button>
          <button
            onClick={() => setActiveTab('send')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'send'
                ? 'text-white bg-white/5 border-b-2 border-white'
                : 'text-white/70 hover:text-white/90 hover:bg-white/5'
            }`}
            type="button"
          >
            Send
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'history'
                ? 'text-white bg-white/5 border-b-2 border-white'
                : 'text-white/70 hover:text-white/90 hover:bg-white/5'
            }`}
            type="button"
          >
            Invoices
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
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createMintQuote();
                        }
                      }}
                      className="flex-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                      placeholder="Amount in sats"
                    />
                    <button
                      onClick={() => void createMintQuote()}
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
                        className="text-xs text-white/70 hover:text-white cursor-pointer"
                        type="button"
                      >
                        Show QR Code
                      </button>
                    </div>
                    {isAutoChecking && (
                      <div className="mb-2 bg-yellow-500/5 border border-yellow-500/20 rounded-md p-2 flex items-center justify-between">
                        <span className="text-xs text-yellow-400">After payment, tokens will be automatically minted</span>
                        <span className="text-xs text-yellow-400 flex items-center">
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
                    onClick={importToken}
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
                    onClick={generateSendToken}
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
                        className="text-xs text-white/70 hover:text-white cursor-pointer"
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

          {/* History Tab Content */}
          {activeTab === 'history' && (
            <div className="h-full">
              <InvoiceHistory mintUrl={mintUrl} />
            </div>
          )}
        </div>
      </div>

      {/* Invoice Modal */}
      <InvoiceModal
        showInvoiceModal={showInvoiceModal}
        mintInvoice={mintInvoice}
        mintAmount={mintAmount}
        mintUnit="sat"
        isAutoChecking={isAutoChecking}
        countdown={countdown}
        setShowInvoiceModal={setShowInvoiceModal}
        setMintInvoice={setMintInvoice}
        setMintQuote={setMintQuote}
        checkIntervalRef={checkIntervalRef}
        countdownIntervalRef={countdownIntervalRef}
        setIsAutoChecking={setIsAutoChecking}
        checkMintQuote={checkMintQuote}
      />
    </div>
  );
};

export default WalletTab;