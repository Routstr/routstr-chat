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

// Import new components
import GeneralTab from './settings/GeneralTab';
import WalletTab from './settings/WalletTab';
import HistoryTab from './settings/HistoryTab';
import InvoiceModal from './settings/InvoiceModal';
import ApiKeysTab from './settings/ApiKeysTab';

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
  setTransactionHistory: (transactionHistory: TransactionHistory[] | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])) => void
}

const SettingsModal = ({
  isOpen,
  onClose,
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
  setTransactionHistory
}: SettingsModalProps) => {
  const { publicKey } = useNostr();
  const [activeTab, setActiveTab] = useState<'settings' | 'wallet' | 'history' | 'api-keys'>('settings');
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

  // Handle auto-saving mint URL changes
  const handleMintUrlChange = useCallback((url: string) => {
    setMintUrl(url);
    localStorage.setItem('mint_url', url);
  }, [setMintUrl]);

  // Handle auto-saving base URL changes
  const handleBaseUrlChange = useCallback((url: string) => {
    setBaseUrl(url);
    localStorage.setItem('base_url', url);
  }, [setBaseUrl]);

  // Initialize wallet when modal opens or mintUrl changes
  useEffect(() => {
    let isMounted = true;

    const initWallet = async () => {
      try {
        const mint = new CashuMint(mintUrl);
        const wallet = new CashuWallet(mint);
        await wallet.loadMint();
        if (isMounted) setCashuWallet(wallet);

        const {apiBalance, proofsBalance} = await fetchBalances(mintUrl, baseUrl);
        setBalance((apiBalance / 1000) + (proofsBalance / 1000)); //balances returned in mSats
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


          const {apiBalance, proofsBalance} = await fetchBalances(mintUrl, baseUrl);
          setBalance((apiBalance / 1000) + newBalance)

          setSuccessMessage('Payment received! Tokens minted successfully.');
          const newTransaction: TransactionHistory = {
            type: 'mint',
            amount: amount,
            timestamp: Date.now(),
            status: 'success',
            message: 'Tokens minted',
            balance: (apiBalance / 1000) + newBalance
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
              
            const {apiBalance, proofsBalance} = await fetchBalances(mintUrl, baseUrl);
            setBalance((apiBalance / 1000) + (proofsBalance / 1000)); //balances returned in mSats
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

      const {apiBalance, proofsBalance} = await fetchBalances(mintUrl, baseUrl);
      const newTransaction: TransactionHistory = {
        type: 'import',
        amount: importedAmount,
        timestamp: Date.now(),
        status: 'success',
        message: 'Tokens imported',
        balance: (apiBalance / 1000) + importedAmount
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
      
      const {apiBalance, proofsBalance} = await fetchBalances(mintUrl, baseUrl);
      const newTransaction: TransactionHistory = {
        type: 'send',
        amount: amount,
        timestamp: Date.now(),
        status: 'success',
        message: 'Tokens sent',
        balance: (apiBalance / 1000) + amount
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
            General
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
          <button
            className={`px-4 py-2 text-sm font-medium ${activeTab === 'api-keys' ? 'text-white border-b-2 border-white' : 'text-white/50 hover:text-white'} cursor-pointer`}
            onClick={() => setActiveTab('api-keys')}
            type="button"
          >
            API Keys
          </button>
        </div>

        <div className="p-4">
          {activeTab === 'settings' ? (
            <GeneralTab
                publicKey={publicKey}
                logout={logout}
                router={router}
                onClose={onClose}
                mintUrl={mintUrl}
                setMintUrl={handleMintUrlChange}
                baseUrl={baseUrl}
                setBaseUrl={handleBaseUrlChange}
                selectedModel={selectedModel}
                handleModelChange={handleModelChange}
                models={models}
            />
          ) : activeTab === 'wallet' ? (
            <WalletTab
                balance={balance}
                error={error}
                successMessage={successMessage}
                mintAmount={mintAmount}
                setMintAmount={setMintAmount}
                createMintQuote={createMintQuote}
                isMinting={isMinting}
                mintInvoice={mintInvoice}
                setShowInvoiceModal={setShowInvoiceModal}
                isAutoChecking={isAutoChecking}
                countdown={countdown}
                sendAmount={sendAmount}
                setSendAmount={setSendAmount}
                generateSendToken={generateSendToken}
                isGeneratingSendToken={isGeneratingSendToken}
                generatedToken={generatedToken}
                tokenToImport={tokenToImport}
                setTokenToImport={setTokenToImport}
                importToken={importToken}
                isImporting={isImporting}
            />
          ) : activeTab === 'history' ? (
            <HistoryTab
                transactionHistory={transactionHistory}
                setTransactionHistory={setTransactionHistory}
                clearConversations={clearConversations}
                onClose={onClose}
            />
          ) : (
            <ApiKeysTab
                balance={balance}
                setBalance={setBalance}
                mintUrl={mintUrl}
                baseUrl={baseUrl}
            />
          )}
        </div>
      </div>

      {/* Invoice Modal */}
      <InvoiceModal
        showInvoiceModal={showInvoiceModal}
        mintInvoice={mintInvoice}
        mintAmount={mintAmount}
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

export default SettingsModal;
