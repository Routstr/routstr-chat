'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, LogOut } from 'lucide-react';
import { CashuMint, CashuWallet, MintQuoteState } from '@cashu/cashu-ts';
import { Model } from '@/data/models';
import QRCode from 'react-qr-code';
import { useNostr } from '@/context/NostrContext';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { TransactionHistory } from '@/types/chat';
import { fetchBalances, getBalanceFromStoredProofs } from '@/utils/cashuUtils';

// Types for Cashu
interface CashuProof {
  amount: number;
  secret: string;
  C: string;
  id: string;
  [key: string]: unknown;
}

interface MintQuoteResponse {
  quote: string;
  request?: string;
  state: MintQuoteState;
  expiry?: number;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mintUrl: string;
  setMintUrl: (url: string) => void;
  selectedModel: Model | null;
  handleModelChange: (modelId: string) => void;
  models: readonly Model[];
  balance: number;
  setBalance: (balance: number | ((prevBalance: number) => number)) => void;
  clearConversations: () => void;
  logout?: () => void;
  router?: AppRouterInstance;
  transactionHistory: TransactionHistory[];
  setTransactionHistory: (transactionHistory: TransactionHistory[] | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])) => void
}

const SettingsModal = ({
  isOpen,
  onClose,
  mintUrl,
  setMintUrl,
  selectedModel,
  handleModelChange,
  models,
  balance,
  setBalance,
  clearConversations,
  logout,
  router,
  transactionHistory, 
  setTransactionHistory
}: SettingsModalProps) => {
  const { publicKey } = useNostr();
  const [tempMintUrl, setTempMintUrl] = useState(mintUrl);
  const [activeTab, setActiveTab] = useState<'settings' | 'wallet' | 'history'>('settings');
  const [mintAmount, setMintAmount] = useState('64');
  const [mintInvoice, setMintInvoice] = useState('');
  const [mintQuote, setMintQuote] = useState<MintQuoteResponse | null>(null);

  const [isMinting, setIsMinting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isGeneratingSendToken, setIsGeneratingSendToken] = useState(false);

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [tokenToImport, setTokenToImport] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [cashuWallet, setCashuWallet] = useState<CashuWallet | null>(null);
  const [isAutoChecking, setIsAutoChecking] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset tempMintUrl when modal opens or mintUrl changes
  useEffect(() => {
    if (isOpen) {
      setTempMintUrl(mintUrl);
    }
  }, [isOpen, mintUrl]);

  // Initialize wallet when modal opens or mintUrl changes
  useEffect(() => {
    let isMounted = true;

    const initWallet = async () => {
      try {
        const mint = new CashuMint(mintUrl);
        const wallet = new CashuWallet(mint);
        await wallet.loadMint();
        if (isMounted) setCashuWallet(wallet);

        const {apiBalance, proofsBalance} = await fetchBalances(mintUrl);
        setBalance(Math.floor(apiBalance / 1000) + Math.floor(proofsBalance / 1000)); //balances returned in mSats
      } catch {
        if (isMounted) setError('Failed to initialize wallet. Please try again.');
      }
    };

    if (isOpen) {
      void initWallet();
    }

    return () => {
      isMounted = false;
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
    // setBalance is stable from parent, so safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mintUrl]);

  const checkMintQuote = useCallback(async () => {
    if (!cashuWallet || !mintQuote) return;

    if (!isAutoChecking) {
      setIsAutoChecking(true);
    }
    setError('');

    try {
      const checkedQuote = await cashuWallet.checkMintQuote(mintQuote.quote);
      if (checkedQuote.state === MintQuoteState.PAID) {
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current);
          checkIntervalRef.current = null;
        }
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        setIsAutoChecking(false);

        try {
          const amount = parseInt(mintAmount, 10);
          const proofs = await cashuWallet.mintProofs(amount, mintQuote.quote);

          const storedProofs = localStorage.getItem('cashu_proofs');
          const existingProofs = storedProofs ? (JSON.parse(storedProofs) as CashuProof[]) : [];
          localStorage.setItem('cashu_proofs', JSON.stringify([...existingProofs, ...proofs]));

          const newBalance = existingProofs.reduce((total, proof) => total + proof.amount, 0) +
            proofs.reduce((total, proof) => total + proof.amount, 0);


          const {apiBalance, proofsBalance} = await fetchBalances(mintUrl);
          setBalance(Math.floor(apiBalance / 1000) + newBalance)

          setSuccessMessage('Payment received! Tokens minted successfully.');
          const newTransaction: TransactionHistory = {
            type: 'mint',
            amount: amount,
            timestamp: Date.now(),
            status: 'success',
            message: 'Tokens minted',
            balance: Math.floor(apiBalance / 1000) + newBalance
          }
          localStorage.setItem('transaction_history', JSON.stringify([...transactionHistory, newTransaction]))
          setTransactionHistory(prev => [...prev, newTransaction]);

          setShowInvoiceModal(false);
          setMintQuote(null);
          setMintInvoice('');
        } catch (mintError) {
          const err = mintError as Error;
          if (err?.message?.includes('already spent') ||
            err?.message?.includes('Token already spent')) {
            setError('This token has already been spent.');
          } else if (err?.message?.includes('already issued') ||
            err?.message?.includes('already minted')) {
              
            const {apiBalance, proofsBalance} = await fetchBalances(mintUrl);
            setBalance(Math.floor(apiBalance / 1000) + Math.floor(proofsBalance / 1000)); //balances returned in mSats
            setSuccessMessage('Payment already processed! Your balance has been updated.');
            setShowInvoiceModal(false);
            setMintQuote(null);
            setMintInvoice('');
          } else {
            setError(err?.message || 'Failed to process the payment. Please try again.');
          }
        }
      }
    } catch (err) {
      if (!isAutoChecking) {
        setError(err instanceof Error ? err.message : 'Failed to check payment status');
      }
    } finally {
      if (!isAutoChecking) {
        setIsAutoChecking(false);
      }
    }
  }, [cashuWallet, mintQuote, isAutoChecking, mintAmount, setBalance]);

  const createMintQuote = useCallback(async () => {
    if (!cashuWallet) return;

    setIsMinting(true);
    setError('');
    setSuccessMessage('');

    try {
      const amount = parseInt(mintAmount, 10);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Please enter a valid amount');
      }

      const quote = await cashuWallet.createMintQuote(amount);
      setMintQuote(quote);
      setMintInvoice(quote.request || '');
      setSuccessMessage('Invoice generated! Pay it to mint tokens.');
      setShowInvoiceModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mint quote');
    } finally {
      setIsMinting(false);
    }
  }, [cashuWallet, mintAmount]);

  const importToken = useCallback(async () => {
    if (!cashuWallet || !tokenToImport.trim()) return;

    setIsImporting(true);
    setError('');
    setSuccessMessage('');

    try {
      const result = await cashuWallet.receive(tokenToImport);
      const proofs = Array.isArray(result) ? result : [];

      if (!proofs || proofs.length === 0) {
        setError('Invalid token format. Please check and try again.');
        return;
      }

      const storedProofs = localStorage.getItem('cashu_proofs');
      const existingProofs = storedProofs ? (JSON.parse(storedProofs) as CashuProof[]) : [];
      localStorage.setItem('cashu_proofs', JSON.stringify([...existingProofs, ...proofs]));

      const importedAmount = proofs.reduce((total: number, proof: CashuProof) => total + proof.amount, 0);

      setBalance((prevBalance) => prevBalance + importedAmount);

      setSuccessMessage(`Successfully imported ${importedAmount} sats!`);

      const {apiBalance, proofsBalance} = await fetchBalances(mintUrl);
      const newTransaction: TransactionHistory = {
        type: 'import',
        amount: importedAmount,
        timestamp: Date.now(),
        status: 'success',
        message: 'Tokens imported',
        balance: Math.floor(apiBalance / 1000) + importedAmount
      }
      localStorage.setItem('transaction_history', JSON.stringify([...transactionHistory, newTransaction]))
      setTransactionHistory(prev => [...prev, newTransaction]);
      setTokenToImport('');
    } catch (err) {
      const error = err as Error;
      if (error?.message?.includes('already spent') ||
        error?.message?.includes('Token already spent')) {
        setError('This token has already been spent.');
      } else {
        setError(error?.message || 'Failed to import token. Please try again.');
      }
    } finally {
      setIsImporting(false);
    }
  }, [cashuWallet, tokenToImport, setBalance]);

  const generateSendToken = useCallback(async () => {
    if (!cashuWallet) return;

    setIsGeneratingSendToken(true);
    setError('');
    setSuccessMessage('');

    try {
      const amount = parseInt(sendAmount, 10);

      if (isNaN(amount) || amount <= 0) {
        throw new Error('Please enter a valid amount');
      }

      if (amount > balance) {
        throw new Error('Amount exceeds available balance');
      }

      const storedProofs = localStorage.getItem('cashu_proofs');
      const existingProofs = storedProofs ? (JSON.parse(storedProofs) as CashuProof[]) : [];

      if (!existingProofs || existingProofs.length === 0) {
        throw new Error('No tokens available to send');
      }

      const sendResult = await cashuWallet.send(amount, existingProofs);
      const { send, keep } = sendResult;

      if (!send || send.length === 0) {
        throw new Error('Failed to generate token');
      }

      localStorage.setItem('cashu_proofs', JSON.stringify(keep));

      setBalance((prevBalance) => prevBalance - amount);

      const tokenObj = {
        token: [{ mint: mintUrl, proofs: send }]
      };
      const token = `cashuA${btoa(JSON.stringify(tokenObj))}`;

      setGeneratedToken(token);
      setSuccessMessage(`Generated token for ${amount} sats. Share it with the recipient.`);
      
      const {apiBalance, proofsBalance} = await fetchBalances(mintUrl);
      const newTransaction: TransactionHistory = {
        type: 'send',
        amount: amount,
        timestamp: Date.now(),
        status: 'success',
        message: 'Tokens sent',
        balance: Math.floor(apiBalance / 1000) + amount
      }
      localStorage.setItem('transaction_history', JSON.stringify([...transactionHistory, newTransaction]))
      setTransactionHistory(prev => [...prev, newTransaction]);
      setSendAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate token');
    } finally {
      setIsGeneratingSendToken(false);
    }
  }, [cashuWallet, sendAmount, balance, mintUrl, setBalance]);

  // Invoice Modal Component
  const InvoiceModal = () => {
    if (!showInvoiceModal || !mintInvoice) return null;

    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={() => setShowInvoiceModal(false)}>
        <div className="bg-black rounded-lg max-w-md w-full m-4 border border-white/10" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center p-4 border-b border-white/10">
            <h3 className="text-lg font-semibold text-white">Lightning Invoice</h3>
            <button onClick={() => setShowInvoiceModal(false)} className="text-white/70 hover:text-white cursor-pointer">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            <div className="p-4 rounded-lg bg-white/5 border border-white/10 flex justify-center">
              <QRCode
                value={mintInvoice}
                size={220}
                level="M"
                fgColor="#FFFFFF"
                bgColor="transparent"
              />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/70">Amount</span>
                <span className="text-sm font-medium text-white">{mintAmount} sats</span>
              </div>

              {isAutoChecking && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 flex items-center justify-between">
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

              <div className="mt-2">
                <div className="text-xs text-white/50 mb-1">Lightning Invoice</div>
                <div className="font-mono text-xs text-white/70 bg-white/5 border border-white/10 rounded-md p-3 break-all">
                  {mintInvoice}
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    try {
                      void navigator.clipboard.writeText(mintInvoice);
                    } catch {
                      // Swallow copy errors
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-md text-sm transition-colors cursor-pointer"
                >
                  Copy Invoice
                </button>
                <button
                  onClick={() => {
                    setShowInvoiceModal(false);
                    setMintInvoice('');
                    setMintQuote(null);
                    if (checkIntervalRef.current) {
                      clearInterval(checkIntervalRef.current);
                      checkIntervalRef.current = null;
                    }
                    if (countdownIntervalRef.current) {
                      clearInterval(countdownIntervalRef.current);
                      countdownIntervalRef.current = null;
                    }
                    setIsAutoChecking(false);
                  }}
                  className="flex-1 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Set up auto-refresh interval when invoice is generated
  useEffect(() => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
      setIsAutoChecking(false);
    }

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    if (mintInvoice && mintQuote) {
      setIsAutoChecking(true);
      setCountdown(3);

      countdownIntervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            void checkMintQuote();
            return 3;
          }
          return prev - 1;
        });
      }, 1000);

      checkIntervalRef.current = setInterval(() => {
        void checkMintQuote();
      }, 3000);
    }

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        setIsAutoChecking(false);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [mintInvoice, mintQuote, checkMintQuote]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-black rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4 border border-white/10" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="text-white/70 hover:text-white cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            className={`px-4 py-2 text-sm font-medium ${activeTab === 'settings' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
            onClick={() => setActiveTab('settings')}
            type="button"
          >
            Settings
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium ${activeTab === 'wallet' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
            onClick={() => setActiveTab('wallet')}
            type="button"
          >
            Wallet
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium ${activeTab === 'history' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
            onClick={() => setActiveTab('history')}
            type="button"
          >
            History
          </button>
        </div>

        <div className="p-4">
          {activeTab === 'settings' ? (
            <>
              {/* Account Section */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-white/80 mb-2">Account</h3>
                <div className="mb-3 bg-white/5 border border-white/10 rounded-md p-3">
                  <div className="text-xs text-white/50 mb-1">Nostr Public Key</div>
                  <div className="font-mono text-xs text-white/70 break-all">
                    {publicKey || 'Not available'}
                  </div>
                </div>
                {logout && router && (
                  <button
                    className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to sign out?')) {
                        logout();
                        router.push('/');
                        onClose();
                      }
                    }}
                    type="button"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign Out</span>
                  </button>
                )}
              </div>

              {/* Mint URL */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-white/80 mb-2">Cashu Mint URL</h3>
                <input
                  type="text"
                  className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  placeholder={process.env.NEXT_PUBLIC_MINT_URL || 'https://mint.minibits.cash/Bitcoin'}
                  value={tempMintUrl}
                  onChange={(e) => setTempMintUrl(e.target.value)}
                />
                <p className="text-xs text-white/50 mt-1">The Cashu mint used for token generation</p>
              </div>

              {/* Model Selection */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-white/80 mb-2">Default Model</h3>
                <div className="bg-white/5 border border-white/10 rounded-md p-4">
                  <p className="text-sm text-white mb-3">Choose your preferred default AI model</p>
                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {models.map((model) => (
                      <div className="flex items-center" key={model.id}>
                        <input
                          type="radio"
                          id={model.id}
                          name="model"
                          className="mr-2"
                          checked={selectedModel?.id === model.id}
                          onChange={() => handleModelChange(model.id)}
                        />
                        <label htmlFor={model.id} className="text-sm text-white">{model.name}</label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="mt-8 pt-4 border-t border-white/10">
                <h3 className="text-sm font-medium text-red-400 mb-4">Danger Zone</h3>
                <div className="space-y-3">
                  <button
                    className="w-full bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-2 rounded-md text-sm hover:bg-red-500/20 transition-colors cursor-pointer"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to clear all conversations? This cannot be undone.')) {
                        clearConversations();
                        onClose();
                      }
                    }}
                    type="button"
                  >
                    Clear conversation history
                  </button>
                </div>
              </div>
            </>
          ) : activeTab === 'wallet' ? (
            /* Wallet Tab */
            <div className="space-y-6">
              {/* Balance Display */}
              <div className="bg-white/5 border border-white/10 rounded-md p-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white/70">Available Balance</span>
                  <div className="flex flex-col items-end">
                    <span className="text-lg font-semibold text-white">{balance} sats</span>
                    <span className="text-sm text-white/69">({balance-getBalanceFromStoredProofs()}+{getBalanceFromStoredProofs()}) sats</span>
                  </div>
                </div>
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

              {/* Mint Tokens Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Mint New Tokens</h3>
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

              {/* Send Tokens Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Send Tokens</h3>
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
                            setSuccessMessage('Token copied to clipboard!');
                            setTimeout(() => setSuccessMessage(''), 3000);
                          } catch {
                            setError('Failed to copy token to clipboard');
                          }
                        }}
                        className="text-xs text-blue-300 hover:text-blue-200 cursor-pointer"
                        type="button"
                      >
                        Copy Token
                      </button>
                    </div>
                    <div className="font-mono text-xs break-all text-white/70">
                      {generatedToken}
                    </div>
                  </div>
                )}
              </div>

              {/* Import Tokens Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-white/80">Import Tokens</h3>
                <div className="space-y-2">
                  <textarea
                    value={tokenToImport}
                    onChange={(e) => setTokenToImport(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white h-24 focus:border-white/30 focus:outline-none"
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
          ) : (
            <div className="space-y-6">
              <h3 className="text-sm font-medium text-white/80 mb-2">Transaction History</h3>
              <div className="bg-white/5 border border-white/10 rounded-md p-4">
                {transactionHistory.length === 0 ? (
                  <div className="text-xs text-white/50 mb-2">No transactions yet</div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {transactionHistory.map((tx, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-white/5 rounded-md">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${
                            tx.status === 'success' ? 'bg-green-500' : 'bg-red-500'
                          }`} />
                          <div>
                            <div className="text-sm font-medium text-white capitalize">{tx.type}</div>
                            <div className="text-sm text-white">{tx.model}</div>
                            <div className="text-xs text-white/50">
                              {new Date(tx.timestamp).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-mono text-white">
                            {tx.amount} sats
                          </div>
                          <div className="text-xs text-white/69">
                            Balance: {tx.balance} sats
                          </div>
                        </div>
                      </div>
                    ))}
                    {/* Danger Zone */}
                    <div className="mt-8 pt-4 border-t border-white/10">
                      <h3 className="text-sm font-medium text-red-400 mb-4">Danger Zone</h3>
                      <div className="space-y-3">
                        <button
                          className="w-full bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-2 rounded-md text-sm hover:bg-red-500/20 transition-colors cursor-pointer"
                          onClick={() => {
                            if (window.confirm('Are you sure you want to clear all transaction history? This cannot be undone.')) {
                              setTransactionHistory([]);
                              localStorage.removeItem('saved_conversations');
                              onClose();
                            }
                          }}
                          type="button"
                        >
                          Clear transaction history
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-8 flex justify-end space-x-2">
            <button
              className="px-4 py-2 bg-transparent text-white/70 hover:text-white rounded-md text-sm transition-colors cursor-pointer"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 bg-black border border-white/10 text-white rounded-md text-sm hover:bg-white/10 transition-colors cursor-pointer"
              onClick={() => {
                setMintUrl(tempMintUrl);
                onClose();
              }}
              type="button"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Invoice Modal */}
      <InvoiceModal />
    </div>
  );
};

export default SettingsModal;
