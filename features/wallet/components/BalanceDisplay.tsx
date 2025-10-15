'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight, Copy, Check, Zap, ArrowLeft, Clock, Trash2, QrCode, ExternalLink, Settings, ChevronDown } from 'lucide-react';
import QRCode from 'react-qr-code';
import { getDecodedToken, getEncodedTokenV4, MeltQuoteState, MintQuoteState } from "@cashu/cashu-ts";
import { useInvoiceSync } from '@/hooks/useInvoiceSync';
import { useChat } from '@/context/ChatProvider';
import { useAuth } from '@/context/AuthProvider';
import { useNostr } from '@/context/NostrContext';
import { formatPublicKey } from '@/lib/nostr';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { 
  useWalletOperations,
  useCashuWallet,
  useCashuToken,
  useCashuStore,
  formatBalance,
  calculateBalanceByMint,
  useTransactionHistoryStore,
} from '@/features/wallet';
import { PendingTransaction } from '../state/transactionHistoryStore';
import { truncateMintUrl as utilTruncateMintUrl, getAvailableMints, isMintValid, getCurrentMintBalance as utilGetCurrentMintBalance } from '@/utils/walletUtils';
import {
  createLightningInvoice,
  mintTokensFromPaidInvoice,
  payMeltQuote,
  createMeltQuote,
} from "@/lib/cashuLightning";
import type { TransactionHistory } from '@/types/chat';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * User balance and authentication status component with comprehensive wallet popover
 * Displays balance in header and shows full wallet interface in popover
 */
interface BalanceDisplayProps {
  setIsSettingsOpen: (isOpen: boolean) => void;
  setInitialSettingsTab: (tab: 'settings' | 'wallet' | 'history' | 'api-keys') => void;
  usingNip60: boolean;
}

const BalanceDisplay: React.FC<BalanceDisplayProps> = ({ setIsSettingsOpen, setInitialSettingsTab, usingNip60 }) => {
  const { isAuthenticated } = useAuth();
  const { balance, currentMintUnit, mintBalances, mintUnits, isBalanceLoading, setIsLoginModalOpen, mintUrl, baseUrl, transactionHistory, setTransactionHistory, setBalance } = useChat();
  const { publicKey } = useNostr();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'send' | 'receive' | 'activity' | 'invoice'>('overview');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const isMobile = useMediaQuery('(max-width: 768px)');
  
  // Send state
  const [sendTab, setSendTab] = useState<'token' | 'lightning'>('token');
  const [sendAmount, setSendAmount] = useState('');
  const [isGeneratingSendToken, setIsGeneratingSendToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState('');
  const [lightningInvoice, setLightningInvoice] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null);
  const [invoiceFeeReserve, setInvoiceFeeReserve] = useState<number | null>(null);
  const [isPayingInvoice, setIsPayingInvoice] = useState(false);
  
  // Receive state
  const [receiveTab, setReceiveTab] = useState<'lightning' | 'token'>('lightning');
  const [mintAmount, setMintAmount] = useState('');
  const [mintInvoice, setMintInvoice] = useState('');
  const [isMinting, setIsMinting] = useState(false);
  const [isAutoChecking, setIsAutoChecking] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [tokenToImport, setTokenToImport] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  
  // Mint selector state
  const [isMintSelectorOpen, setIsMintSelectorOpen] = useState(false);
  
  // Common state
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  
  // Auto-checking refs
  const autoCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const {
    initWallet,
    generateSendToken: hookGenerateSendToken,
    createMintQuote,
    checkMintQuote,
    importToken: hookImportToken,
  } = useWalletOperations({
    mintUrl,
    baseUrl,
    setBalance,
    setTransactionHistory,
    transactionHistory
  });

  // NIP-60 wallet hooks
  const { wallet, isLoading: isNip60Loading, updateProofs } = useCashuWallet();
  const { sendToken: nip60SendToken, cleanSpentProofs, cleanupPendingProofs, receiveToken, isLoading: isTokenLoading, error: nip60Error } = useCashuToken();
  const cashuStore = useCashuStore();
  const transactionHistoryStore = useTransactionHistoryStore();

  // NIP-60 specific state
  const [nip60Invoice, setNip60Invoice] = useState("");
  const [nip60QuoteId, setNip60QuoteId] = useState("");
  const [nip60PendingTxId, setNip60PendingTxId] = useState<string | null>(null);
  const [isNip60Processing, setIsNip60Processing] = useState(false);
  
  // NIP-60 Lightning payment state
  const [nip60SendInvoice, setNip60SendInvoice] = useState("");
  const [nip60MeltQuoteId, setNip60MeltQuoteId] = useState("");
  const [isNip60LoadingInvoice, setIsNip60LoadingInvoice] = useState(false);
  const nip60ProcessingInvoiceRef = useRef<string | null>(null);

  // Helper function to generate unique IDs
  const generateId = () => crypto.randomUUID();

  // Function to truncate npub for display
  const truncateNpub = (npub: string): string => {
    if (npub.length <= 16) return npub;
    return `${npub.slice(0, 8)}...${npub.slice(-6)}`;
  };

  // Get formatted npub
  const npub = publicKey ? formatPublicKey(publicKey) : '';
  const truncatedNpub = npub ? truncateNpub(npub) : '';

  // Use shared mint helpers
  const truncateMintUrl = utilTruncateMintUrl;

  // Handle mint selection
  const handleMintSelection = (mintUrl: string) => {
    if (cashuStore.setActiveMintUrlByUser) {
      cashuStore.setActiveMintUrlByUser(mintUrl);
    } else {
      cashuStore.setActiveMintUrl(mintUrl);
    }
    setIsMintSelectorOpen(false);
    setError(''); // Clear any previous errors
  };

  // Get available mints from mintBalances
  const availableMints = getAvailableMints(mintBalances);

  // Check if user has any mints available
  const hasMints = availableMints.length > 0;

  // Check if current mint is valid
  const isCurrentMintValid = isMintValid(cashuStore.activeMintUrl, availableMints);

  // Stop auto-checking
  const stopAutoChecking = useCallback(() => {
    setIsAutoChecking(false);
    if (autoCheckIntervalRef.current) {
      clearInterval(autoCheckIntervalRef.current);
      autoCheckIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  // Page transition function
  const navigateToTab = (tab: 'overview' | 'send' | 'receive' | 'activity' | 'invoice') => {
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(tab);
      setIsTransitioning(false);
    }, 150);
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

    if (isAuthenticated) {
      void initializeWallet();
    }
  }, [mintUrl, initWallet]);

  // Clean up intervals on unmount
  useEffect(() => {
    return () => {
      if (autoCheckIntervalRef.current) {
        clearInterval(autoCheckIntervalRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Reset states when popover opens/closes
  React.useEffect(() => {
    if (isPopoverOpen) {
      setActiveTab('overview');
      setSendAmount('');
      setGeneratedToken('');
      setMintAmount('');
      setMintInvoice('');
      setTokenToImport('');
      setLightningInvoice('');
      setInvoiceAmount(null);
      setInvoiceFeeReserve(null);
      setError('');
      setSuccessMessage('');
      setCopySuccess(false);
      setIsGeneratingSendToken(false);
      setIsMinting(false);
      setIsAutoChecking(false);
      setIsImporting(false);
      setIsPayingInvoice(false);
      setIsTransitioning(false);
      // Clear mint selector state
      setIsMintSelectorOpen(false);
      // Clear NIP-60 state
      setNip60Invoice("");
      setNip60QuoteId("");
      setNip60PendingTxId(null);
      setIsNip60Processing(false);
      setNip60SendInvoice("");
      setNip60MeltQuoteId("");
      setIsNip60LoadingInvoice(false);
      nip60ProcessingInvoiceRef.current = null;
      // Stop auto-checking when popover opens
      stopAutoChecking();
    } else {
      // Clean up intervals when popover closes
      stopAutoChecking();
    }
  }, [isPopoverOpen, stopAutoChecking]);

  // Handle payment success - redirect to overview instead of showing message
  React.useEffect(() => {
    if (successMessage === 'Payment received! Tokens minted successfully.') {
      // Clear the success message immediately
      setSuccessMessage('');
      // Stop auto-checking
      stopAutoChecking();
      // Navigate to overview tab
      navigateToTab('overview');
      // Clear invoice-related state
      setMintInvoice('');
      setMintAmount('');
    }
  }, [successMessage, stopAutoChecking]);

  // Stop auto-checking when navigating away from invoice page
  React.useEffect(() => {
    if (activeTab !== 'invoice' && isAutoChecking) {
      stopAutoChecking();
    }
  }, [activeTab, isAutoChecking, stopAutoChecking]);

  // Auto-checking for mint quote
  const startAutoChecking = useCallback(() => {
    if (isAutoChecking) return;
    
    setIsAutoChecking(true);
    setCountdown(5);
    
    // Start countdown
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return 5;
        }
        return prev - 1;
      });
    }, 1000);

    // Start auto-checking immediately, then every 5 seconds
    const checkPayment = async () => {
      try {
        await checkMintQuote(
          isAutoChecking,
          setIsAutoChecking,
          mintAmount,
          setError,
          setSuccessMessage,
          () => {}, // setShowInvoiceModal
          () => {}, // setMintQuote
          setMintInvoice,
          countdown,
          setCountdown
        );
      } catch (error) {
        console.error('Auto-check error:', error);
      }
    };

    // Check immediately
    checkPayment();
    
    // Then check every 5 seconds
    autoCheckIntervalRef.current = setInterval(checkPayment, 5000);
  }, [checkMintQuote, isAutoChecking, mintAmount, countdown]);

  // NIP-60 Lightning invoice creation
  const createNip60Invoice = useCallback(async (amount: number) => {
    if (!cashuStore.activeMintUrl) {
      setError("No active mint selected. Please select a mint in your wallet settings.");
      return;
    }

    try {
      setIsNip60Processing(true);
      setError('');

      const invoiceData = await createLightningInvoice(cashuStore.activeMintUrl, amount);
      setNip60Invoice(invoiceData.paymentRequest);
      setNip60QuoteId(invoiceData.quoteId);

      // Store invoice persistently for recovery
      await addInvoice({
        type: 'mint',
        mintUrl: cashuStore.activeMintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
        amount: amount,
        state: MintQuoteState.UNPAID,
        expiresAt: invoiceData.expiresAt
      });

      // Create pending transaction
      const pendingTxId = generateId();
      const pendingTransaction: PendingTransaction = {
        id: pendingTxId,
        direction: "in",
        amount: amount.toString(),
        timestamp: Math.floor(Date.now() / 1000),
        status: "pending",
        mintUrl: cashuStore.activeMintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
      };

      transactionHistoryStore.addPendingTransaction(pendingTransaction);
      setNip60PendingTxId(pendingTxId);

      // Start polling for payment status
      checkNip60PaymentStatus(cashuStore.activeMintUrl, invoiceData.quoteId, amount, pendingTxId);
    } catch (error) {
      console.error("Error creating NIP-60 invoice:", error);
      setError("Failed to create Lightning invoice: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsNip60Processing(false);
    }
  }, [cashuStore.activeMintUrl, transactionHistoryStore]);

  // Check NIP-60 payment status
  const checkNip60PaymentStatus = useCallback(async (mintUrl: string, quoteId: string, amount: number, pendingTxId: string) => {
    try {
      const proofs = await mintTokensFromPaidInvoice(mintUrl, quoteId, amount);

      if (proofs.length > 0) {
        await updateProofs({
          mintUrl,
          proofsToAdd: proofs,
          proofsToRemove: [],
        });

        transactionHistoryStore.removePendingTransaction(pendingTxId);
        setNip60PendingTxId(null);
        setSuccessMessage(`Received ${formatBalance(amount, currentMintUnit)}s!`);
        setNip60Invoice("");
        setNip60QuoteId("");
        setMintAmount("");
        // Navigate back to overview after successful payment
        navigateToTab('overview');
        setTimeout(() => setSuccessMessage(""), 5000);
      } else {
        setTimeout(() => {
          if (nip60QuoteId === quoteId) {
            checkNip60PaymentStatus(mintUrl, quoteId, amount, pendingTxId);
          }
        }, 5000);
      }
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("not been paid"))) {
        console.error("Error checking NIP-60 payment status:", error);
        setError("Failed to check payment status: " + (error instanceof Error ? error.message : String(error)));
      } else {
        setTimeout(() => {
          if (nip60QuoteId === quoteId) {
            checkNip60PaymentStatus(mintUrl, quoteId, amount, pendingTxId);
          }
        }, 5000);
      }
    }
  }, [updateProofs, transactionHistoryStore, nip60QuoteId, navigateToTab]);

  // NIP-60 Lightning invoice input handler
  const handleNip60InvoiceInput = useCallback(async (value: string) => {
    if (!cashuStore.activeMintUrl) {
      setError("No active mint selected. Please select a mint in your wallet settings.");
      return;
    }

    // Prevent duplicate processing of the same invoice
    if (nip60ProcessingInvoiceRef.current === value || nip60MeltQuoteId) {
      return;
    }

    setNip60SendInvoice(value);
    nip60ProcessingInvoiceRef.current = value;

    // Create melt quote
    const mintUrl = cashuStore.activeMintUrl;
    try {
      setIsNip60LoadingInvoice(true);
      const meltQuote = await createMeltQuote(mintUrl, value);
      setNip60MeltQuoteId(meltQuote.quote);

      // Parse amount from invoice
      setInvoiceAmount(meltQuote.amount);
      setInvoiceFeeReserve(meltQuote.fee_reserve);
      
      // Store melt invoice persistently
      await addInvoice({
        type: 'melt',
        mintUrl: mintUrl,
        quoteId: meltQuote.quote,
        paymentRequest: value,
        amount: meltQuote.amount,
        state: MeltQuoteState.UNPAID,
        fee: meltQuote.fee_reserve
      });
    } catch (error) {
      console.error("Error creating NIP-60 melt quote:", error);
      setError("Failed to create melt quote: " + (error instanceof Error ? error.message : String(error)));
      setNip60MeltQuoteId(""); // Reset quote ID on error
      // Clear states on error
      setNip60SendInvoice("");
      setInvoiceAmount(null);
      setInvoiceFeeReserve(null);
    } finally {
      setIsNip60LoadingInvoice(false);
      nip60ProcessingInvoiceRef.current = null;
    }
  }, [cashuStore.activeMintUrl, nip60MeltQuoteId]);

  // NIP-60 Lightning payment
  const handleNip60PayInvoice = useCallback(async () => {
    if (!nip60SendInvoice) {
      setError("Please enter a Lightning invoice");
      return;
    }

    if (error && nip60SendInvoice) {
      await handleNip60InvoiceInput(nip60SendInvoice);
    }

    if (!cashuStore.activeMintUrl) {
      setError("No active mint selected. Please select a mint in your wallet settings.");
      return;
    }

    if (!invoiceAmount) {
      setError("Could not parse invoice amount");
      return;
    }

    try {
      setIsNip60Processing(true);
      setError('');

      // Get active mint
      const mintUrl = cashuStore.activeMintUrl;

      // Select proofs to spend
      const selectedProofs = await cashuStore.getMintProofs(mintUrl);
      const totalProofsAmount = selectedProofs.reduce((sum, p) => sum + p.amount, 0);

      if (totalProofsAmount < invoiceAmount + (invoiceFeeReserve || 0)) {
        setError(`Insufficient balance: have ${formatBalance(totalProofsAmount, currentMintUnit)}s, need ${formatBalance(invoiceAmount + (invoiceFeeReserve || 0), currentMintUnit)}s`);
        setIsNip60Processing(false);
        return;
      }

      // Pay the invoice
      const result = await payMeltQuote(mintUrl, nip60MeltQuoteId, selectedProofs, cleanSpentProofs);

      if (result.success) {
        // Remove spent proofs from the store
        await updateProofs({
          mintUrl,
          proofsToAdd: [...result.keep, ...result.change],
          proofsToRemove: selectedProofs,
        });

        setSuccessMessage(`Paid ${formatBalance(invoiceAmount, currentMintUnit)}s!`);
        // Update invoice status to paid
        await updateInvoice(nip60MeltQuoteId, {
          state: MeltQuoteState.PAID,
          paidAt: Date.now()
        });

        setSuccessMessage(`Paid ${formatBalance(invoiceAmount, currentMintUnit)}s!`);
        handleNip60PaymentCancel();
        setTimeout(() => setSuccessMessage(""), 5000);
      }
    } catch (error) {
      console.error("Error paying NIP-60 invoice:", error);
      setError("Failed to pay Lightning invoice: " + (error instanceof Error ? error.message : String(error)));
      setNip60MeltQuoteId(""); // Reset quote ID on error
    } finally {
      setIsNip60Processing(false);
    }
  }, [nip60SendInvoice, cashuStore.activeMintUrl, invoiceAmount, invoiceFeeReserve, nip60MeltQuoteId, updateProofs, error, handleNip60InvoiceInput]);

  // NIP-60 payment cancellation
  const handleNip60PaymentCancel = useCallback(() => {
    setNip60SendInvoice("");
    setNip60MeltQuoteId("");
    setInvoiceAmount(null);
    setInvoiceFeeReserve(null);
    nip60ProcessingInvoiceRef.current = null;
  }, []);

  // Wallet operations
  const generateSendToken = useCallback(async () => {
    if (usingNip60) {
      if (!cashuStore.activeMintUrl) {
        setError("No active mint selected. Please select a mint in your wallet settings.");
        return;
      }

      if (!sendAmount || isNaN(parseInt(sendAmount))) {
        setError("Please enter a valid amount");
        return;
      }

      try {
        setError('');
        setSuccessMessage('');
        setGeneratedToken("");
        setIsGeneratingSendToken(true);

        const amountValue = parseInt(sendAmount);
        const { proofs, unit } = await nip60SendToken(cashuStore.activeMintUrl, amountValue);
        const token = getEncodedTokenV4({
          mint: cashuStore.activeMintUrl,
          proofs: proofs.map((p) => ({
            id: p.id || "",
            amount: p.amount,
            secret: p.secret || "",
            C: p.C || "",
          })),
          unit: unit
        });

        setGeneratedToken(token as string);
        setSuccessMessage(`Token generated for ${formatBalance(amountValue, unit)}`);

        // Clean up pending proofs after successful token creation
        if ((proofs as any).pendingProofsKey) {
          cleanupPendingProofs((proofs as any).pendingProofsKey);
        }

      } catch (error) {
        console.error("Error generating NIP-60 token:", error);
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsGeneratingSendToken(false);
      }
      return;
    }
    
    await hookGenerateSendToken(
      setIsGeneratingSendToken,
      setError,
      setSuccessMessage,
      sendAmount,
      balance,
      setSendAmount,
      setGeneratedToken
    );
  }, [hookGenerateSendToken, sendAmount, balance, usingNip60, cashuStore.activeMintUrl, nip60SendToken]);

  const handleCreateMintQuote = useCallback(async () => {
    if (usingNip60) {
      const amount = parseInt(mintAmount);
      if (isNaN(amount) || amount <= 0) {
        setError("Please enter a valid amount");
        return;
      }
      await createNip60Invoice(amount);
      navigateToTab('invoice');
      return;
    }
    try {
      await createMintQuote(
        setIsMinting,
        setError,
        setSuccessMessage,
        () => {}, // setShowInvoiceModal
        mintAmount,
        () => {}, // setMintQuote 
        setMintInvoice
      );
      
      // Navigate to invoice page after creation
      setTimeout(() => {
        navigateToTab('invoice');
        // Start auto-checking after navigation
        setTimeout(() => startAutoChecking(), 300);
      }, 500);
    } catch (error) {
      console.error('Error creating mint quote:', error);
      setError('Failed to create invoice. Please try again.');
    }
  }, [createMintQuote, mintAmount, startAutoChecking, navigateToTab, usingNip60, createNip60Invoice]);

  const handleCheckMintQuote = useCallback(async () => {
    await checkMintQuote(
      isAutoChecking,
      setIsAutoChecking,
      mintAmount,
      setError,
      setSuccessMessage,
      () => {}, // setShowInvoiceModal
      () => {}, // setMintQuote
      setMintInvoice,
      countdown,
      setCountdown
    );
  }, [checkMintQuote, isAutoChecking, mintAmount, countdown]);

  const handleImportToken = useCallback(async () => {
    if (usingNip60) {
      if (!tokenToImport) {
        setError("Please enter a token");
        return;
      }

      try {
        setError('');
        setSuccessMessage('');
        setIsImporting(true);

        const unit = getDecodedToken(tokenToImport).unit;
        const proofs = await receiveToken(tokenToImport);
        const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);

        setSuccessMessage(`Received ${formatBalance(totalAmount, unit ? `${unit}s` : 'sats')} successfully!`);
        setTokenToImport("");
      } catch (error) {
        console.error("Error receiving NIP-60 token:", error);
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsImporting(false);
      }
      return;
    }
    await hookImportToken(
      setIsImporting,
      setError,
      setSuccessMessage,
      tokenToImport,
      setTokenToImport
    );
  }, [hookImportToken, tokenToImport, usingNip60, receiveToken]);

  // Lightning invoice payment
  const handlePayLightningInvoice = useCallback(async () => {
    if (usingNip60) {
      await handleNip60PayInvoice();
      return;
    }
    if (!lightningInvoice) {
      setError('Please enter a lightning invoice');
      return;
    }

    setIsPayingInvoice(true);
    setError('');
    
    try {
      // Mock parsing invoice amount (in real implementation, use lightning library)
      // This is a simplified version - real implementation would parse the invoice
      const mockAmount = 1000; // This should be parsed from the actual invoice
      setInvoiceAmount(mockAmount);
      setInvoiceFeeReserve(10); // Mock fee reserve
      
      // Mock payment process
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simulate successful payment
      setSuccessMessage(`Successfully paid ${mockAmount} sats!`);
      setLightningInvoice('');
      setInvoiceAmount(null);
      setInvoiceFeeReserve(null);
      
      // Update balance (mock)
      setBalance(prev => prev - mockAmount - 10);
      
      // Add to transaction history
      const newTransaction: TransactionHistory = {
        type: 'send',
        amount: mockAmount + 10,
        timestamp: Date.now(),
        status: 'success',
        balance: balance - mockAmount - 10
      };
      setTransactionHistory(prev => [...prev, newTransaction]);
      
    } catch (error) {
      setError('Failed to pay lightning invoice. Please try again.');
    } finally {
      setIsPayingInvoice(false);
    }
  }, [lightningInvoice, balance, setBalance, setTransactionHistory, usingNip60, handleNip60PayInvoice]);

  const copyToClipboard = async (text: string, type: string = 'text') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setSuccessMessage(`${type} copied to clipboard!`);
      setTimeout(() => {
        setCopySuccess(false);
        setSuccessMessage('');
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      setError('Failed to copy to clipboard');
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'send' | 'receive') => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      if (type === 'send') {
        setSendAmount(value);
      } else {
        setMintAmount(value);
      }
      setError('');
    }
  };

  // Clear transaction history
  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear all transaction history? This cannot be undone.')) {
      setTransactionHistory([]);
      setSuccessMessage('Transaction history cleared');
      setTimeout(() => setSuccessMessage(''), 2000);
    }
  };

  const isValidSendAmount = sendAmount && parseInt(sendAmount) > 0 && parseInt(sendAmount) <= (usingNip60 ? utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances) : (currentMintUnit === 'msat' ? balance * 1000 : balance));
  const isValidReceiveAmount = mintAmount && parseInt(mintAmount) > 0;

  const getTabTitle = () => {
    switch (activeTab) {
      case 'send':
        return 'Send';
      case 'receive':
        return 'Receive';
      case 'activity':
        return 'Activity';
      case 'invoice':
        return 'Invoice';
      default:
        return 'Wallet';
    }
  };

  if (!isAuthenticated) {
    return (
      <button
        onClick={() => setIsLoginModalOpen(true)}
        className="px-3 py-1.5 rounded-full bg-white text-black hover:bg-gray-200 transition-colors text-xs cursor-pointer"
      >
        Sign in
      </button>
    );
  }

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <button className={"flex items-center gap-2 text-white bg-white/5 hover:bg-white/10 rounded-md py-2 px-3 sm:px-4 h-[36px] text-xs sm:text-sm transition-colors cursor-pointer border border-white/10 justify-center"}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-wallet flex-shrink-0"
          >
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
          </svg>
          <span className={isMobile ? 'text-xs' : 'text-sm'}>
            {isBalanceLoading ? 'loading' : `${balance} sats`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        align="end" 
        sideOffset={isMobile ? 12 : 4}
        className={`${
          isMobile ? 'w-[92vw]' : 'w-72'
        } bg-[#181818] border border-white/10 rounded-md shadow-lg p-0 max-h-[70vh] overflow-hidden`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          {activeTab !== 'overview' && activeTab !== 'invoice' ? (
            <div className="flex items-center gap-3 flex-1">
              <button
                onClick={() => navigateToTab('overview')}
                className="text-white/70 hover:text-white transition-colors p-1 -ml-1 cursor-pointer"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h3 className="text-lg font-semibold text-white">
                {getTabTitle()}
              </h3>
              
              {/* Mint Selector in Header - for Send and Receive tabs */}
              {usingNip60 && (activeTab === 'send' || activeTab === 'receive') && (
                <div className="ml-auto relative">
                  {hasMints ? (
                    <div className="relative">
                      <button
                        onClick={() => setIsMintSelectorOpen(!isMintSelectorOpen)}
                        className={`bg-white/5 border rounded-md px-2 py-1 text-white text-xs focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20 flex items-center gap-1 cursor-pointer min-w-[120px] ${
                          !isCurrentMintValid ? 'border-red-500/50' : 'border-white/20'
                        }`}
                        title={cashuStore.activeMintUrl || 'Select a mint'}
                      >
                        <span className="truncate flex-1 text-left">
                          {cashuStore.activeMintUrl ? truncateMintUrl(cashuStore.activeMintUrl) : 'Select mint'}
                        </span>
                        <ChevronDown className={`h-3 w-3 transition-transform flex-shrink-0 ${isMintSelectorOpen ? 'rotate-180' : ''}`} />
                      </button>
                      
                      {isMintSelectorOpen && (
                        <div className="absolute top-full right-0 mt-1 bg-[#181818] border border-white/20 rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto min-w-[200px]">
                          {availableMints.map((mintUrl) => (
                            <button
                              key={mintUrl}
                              onClick={() => handleMintSelection(mintUrl)}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors cursor-pointer ${
                                cashuStore.activeMintUrl === mintUrl ? 'bg-white/5 text-white' : 'text-white/70'
                              }`}
                            >
                              <div className="truncate">{truncateMintUrl(mintUrl)}</div>
                              <div className="text-xs text-white/50">
                                {formatBalance(mintBalances[mintUrl] || 0, mintUnits[mintUrl] || 'sat')}s
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md px-2 py-1">
                      <div className="text-yellow-200 text-xs">
                        No mints
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-white">
                {activeTab === 'invoice' ? 'Invoice' : 'Wallet'}
              </h3>
            </div>
          )}
          
          {/* Settings Icon - Top Right */}
          {activeTab === 'overview' && (
            <button
              onClick={() => {
                setIsSettingsOpen(true);
                setInitialSettingsTab('wallet');
                setIsPopoverOpen(false);
              }}
              className="text-white/70 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/5 cursor-pointer"
              title="Wallet Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className={`transition-all duration-300 ${isTransitioning ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0'} overflow-y-auto max-h-[500px]`}>
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="p-4">
              {/* Mint Selector for Overview - Top Right */}
              {usingNip60 && (
                <div className="flex justify-end mb-3">
                  {hasMints ? (
                    <div className="relative">
                      <button
                        onClick={() => setIsMintSelectorOpen(!isMintSelectorOpen)}
                        className={`bg-white/5 border rounded-md px-2 py-1 text-white text-xs focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20 flex items-center gap-1 cursor-pointer min-w-[120px] ${
                          !isCurrentMintValid ? 'border-red-500/50' : 'border-white/20'
                        }`}
                        title={cashuStore.activeMintUrl || 'Select a mint'}
                      >
                        <span className="truncate flex-1 text-left">
                          {cashuStore.activeMintUrl ? truncateMintUrl(cashuStore.activeMintUrl) : 'Select mint'}
                        </span>
                        <ChevronDown className={`h-3 w-3 transition-transform flex-shrink-0 ${isMintSelectorOpen ? 'rotate-180' : ''}`} />
                      </button>
                      
                      {isMintSelectorOpen && (
                        <div className="absolute top-full right-0 mt-1 bg-[#181818] border border-white/20 rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto min-w-[200px]">
                          {availableMints.map((mintUrl) => (
                            <button
                              key={mintUrl}
                              onClick={() => handleMintSelection(mintUrl)}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors cursor-pointer ${
                                cashuStore.activeMintUrl === mintUrl ? 'bg-white/5 text-white' : 'text-white/70'
                              }`}
                            >
                              <div className="truncate">{truncateMintUrl(mintUrl)}</div>
                              <div className="text-xs text-white/50">
                                {formatBalance(mintBalances[mintUrl] || 0, mintUnits[mintUrl] || 'sat')}s
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md px-2 py-1">
                      <div className="text-yellow-200 text-xs">
                        No mints
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Balance Display */}
              <div className="text-center mb-4">
                <div className="text-white/60 text-sm font-medium mb-1">
                  {truncatedNpub}
                </div>
                <div className="text-white/60 text-sm mb-2">Balance</div>
                <div className="text-white text-2xl font-bold">
                  {isBalanceLoading ? 'loading' : `${balance} sats`}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={() => navigateToTab('receive')}
                  className="flex flex-col items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-6 transition-colors cursor-pointer"
                >
                  <ArrowDownLeft className="h-6 w-6 text-white/70" />
                  <span className="text-white/70 text-sm font-medium">Receive</span>
                </button>

                <button
                  onClick={() => navigateToTab('send')}
                  className="flex flex-col items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-6 transition-colors cursor-pointer"
                >
                  <ArrowUpRight className="h-6 w-6 text-white/70" />
                  <span className="text-white/70 text-sm font-medium">Send</span>
                </button>
              </div>

              {/* Quick Activity Preview */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white/70 text-sm font-medium">Recent Activity</span>
                  <button
                    onClick={() => navigateToTab('activity')}
                    className="text-white/50 hover:text-white/70 text-xs cursor-pointer"
                  >
                    View All
                  </button>
                </div>
                <div className="space-y-2">
                  {transactionHistory.slice(-3).reverse().map((tx, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          tx.type === 'send' || tx.type === 'spent' ? 'bg-red-500' : 'bg-green-500'
                        }`} />
                        <span className="text-white/60 text-xs capitalize">{tx.type}</span>
                      </div>
                      <span className="text-white/60 text-xs font-mono">
                        {tx.type === 'send' || tx.type === 'spent' ? '-' : '+'}
                        {tx.amount} sats
                      </span>
                    </div>
                  ))}
                  {transactionHistory.length === 0 && (
                    <div className="text-white/50 text-xs text-center py-2">
                      No transactions yet
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Send Tab Content */}
          {activeTab === 'send' && (
            <div className="p-4 space-y-3">
              {/* Sub-tabs for Token/Lightning */}
                            {/* Note about msats if using msat unit */}
              {currentMintUnit === 'msat' && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
                  <div className="text-blue-200 text-sm text-center">
                    Note: You are using msats (millisats). 1 sat = 1000 msats
                  </div>
                </div>
              )}
              <div className="flex bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setSendTab('token')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    sendTab === 'token'
                      ? 'bg-white/10 text-white'
                      : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  eCash Token
                </button>
                <button
                  onClick={() => setSendTab('lightning')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                    sendTab === 'lightning'
                      ? 'bg-white/10 text-white'
                      : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  <Zap className="h-3 w-3" />
                  Lightning
                </button>
              </div>

              {sendTab === 'token' && (
                <div className="space-y-3">
                  {/* Balance context */}
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <div className="text-white/60 text-xs">Available Balance</div>
                    <div className="text-white text-lg font-bold">
                    {usingNip60 ? (
                        <>
                          {currentMintUnit === 'msat' ? utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances) : utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances)} {currentMintUnit === 'msat' ? 'msats' : 'sats'}
                        </>
                      ) : (
                        <>
                          {currentMintUnit === 'msat' ? balance * 1000 : balance} {currentMintUnit === 'msat' ? 'msats' : 'sats'}
                        </>
                      )}
                    </div>
                    {usingNip60 && !isCurrentMintValid && (
                      <div className="text-red-400 text-xs mt-1">
                        Invalid mint selected
                      </div>
                    )}
                    {usingNip60 && isCurrentMintValid && utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances) === 0 && (
                      <div className="text-yellow-400 text-xs mt-1">
                        No balance available in selected mint
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-white/70 text-xs font-medium mb-2">
                      Amount ({currentMintUnit}s)
                    </label>
                    <input
                      type="text"
                      value={sendAmount}
                      onChange={(e) => handleAmountChange(e, 'send')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void generateSendToken();
                        }
                      }}
                      className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white text-lg font-mono focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                      placeholder="0"
                      autoFocus
                    />
                    {sendAmount && parseInt(sendAmount) > (usingNip60 ? utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances) : (currentMintUnit === 'msat' ? balance * 1000 : balance)) && (
                      <p className="text-red-400 text-xs mt-1">
                        Amount exceeds available balance
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-1">
                    {[100, 500, 1000].map((amount) => (
                      <button
                        key={amount}
                        onClick={() => setSendAmount(amount.toString())}
                        disabled={amount > (usingNip60 ? utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances) : (currentMintUnit === 'msat' ? balance * 1000 : balance))}
                        className="py-1.5 px-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 rounded-md text-white/70 text-xs transition-colors cursor-pointer"
                      >
                        {amount}
                      </button>
                    ))}
                    <button
                      onClick={() => setSendAmount((usingNip60 ? utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances) : (currentMintUnit === 'msat' ? balance * 1000 : balance)).toString())}
                      disabled={usingNip60 ? utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances) === 0 : balance === 0}
                      className="py-1.5 px-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 rounded-md text-white/70 text-xs transition-colors cursor-pointer"
                    >
                      Max
                    </button>
                  </div>

                  <button
                    onClick={generateSendToken}
                    disabled={!isValidSendAmount || isGeneratingSendToken || (usingNip60 && (!hasMints || !isCurrentMintValid))}
                    className="w-full bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed border border-white/20 text-white py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isGeneratingSendToken ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                        Generating...
                      </>
                    ) : (
                      'Generate Token'
                    )}
                  </button>

                  {generatedToken && (
                    <div className="space-y-2">
                      <div className="text-white/70 text-xs font-medium">Generated Token:</div>
                      <div className="bg-white/5 border border-white/20 rounded-lg p-2">
                        <div className="font-mono text-xs text-white/70 break-all mb-2 max-h-20 overflow-y-auto">
                          {generatedToken}
                        </div>
                        <button
                          onClick={() => copyToClipboard(generatedToken, 'Token')}
                          className="w-full bg-white/10 hover:bg-white/15 border border-white/20 text-white py-1.5 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {copySuccess ? (
                            <>
                              <Check className="h-3 w-3" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Copy Token
                            </>
                          )}
                        </button>
                      </div>
                      <div className="text-white/50 text-xs text-center">
                        Share this token to send {sendAmount} {currentMintUnit}s
                      </div>
                    </div>
                  )}
                </div>
              )}

              {sendTab === 'lightning' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-white/70 text-xs font-medium mb-2">
                      Lightning Invoice
                    </label>
                    <textarea
                      value={usingNip60 ? nip60SendInvoice : lightningInvoice}
                      onChange={(e) => usingNip60 ? handleNip60InvoiceInput(e.target.value) : setLightningInvoice(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handlePayLightningInvoice();
                        }
                      }}
                      className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white text-xs font-mono focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20 min-h-[80px] resize-y"
                      placeholder="Paste lightning invoice here..."
                      autoFocus
                    />
                  </div>

                  {invoiceAmount && (
                    <div className="bg-white/5 border border-white/20 rounded-lg p-3">
                      <div className="text-white/70 text-xs mb-1">Invoice Amount</div>
                      <div className="text-white text-lg font-bold">
                        {invoiceAmount} {currentMintUnit}s
                        {invoiceFeeReserve !== 0 && (
                          <span className="text-xs font-normal text-white/50 ml-2">
                            + max {invoiceFeeReserve} fee
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handlePayLightningInvoice}
                      disabled={!(usingNip60 ? nip60SendInvoice.trim() : lightningInvoice.trim()) || (usingNip60 ? isNip60Processing || isNip60LoadingInvoice : isPayingInvoice)}
                      className="flex-1 bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed border border-white/20 text-white py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {(usingNip60 ? isNip60Processing : isPayingInvoice) ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                          Paying...
                        </>
                      ) : (usingNip60 && isNip60LoadingInvoice) ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <Zap className="h-4 w-4" />
                          Pay Invoice
                        </>
                      )}
                    </button>
                    
                    {/* Cancel button - only show when there's an invoice being processed */}
                    {usingNip60 && (nip60SendInvoice.trim() || nip60MeltQuoteId) && (
                      <button
                        onClick={handleNip60PaymentCancel}
                        disabled={isNip60Processing}
                        className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-red-500/30 text-red-200 rounded-lg font-medium transition-colors cursor-pointer"
                        title="Cancel and clear invoice"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="text-white/50 text-xs text-center">
                    Paste a lightning invoice to pay it instantly
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Receive Tab Content */}
          {activeTab === 'receive' && (
            <div className="p-4 space-y-3">
              {/* Note about msats if using msat unit */}
              {currentMintUnit === 'msat' && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
                  <div className="text-blue-200 text-sm text-center">
                    Note: You are using msats (millisats). 1 sat = 1000 msats
                  </div>
                </div>
              )}
              
              {/* Sub-tabs for Lightning/Token */}
              <div className="flex bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setReceiveTab('lightning')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                    receiveTab === 'lightning'
                      ? 'bg-white/10 text-white'
                      : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  <Zap className="h-3 w-3" />
                  Lightning
                </button>
                <button
                  onClick={() => setReceiveTab('token')}
                  className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    receiveTab === 'token'
                      ? 'bg-white/10 text-white'
                      : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  Token
                </button>
              </div>

              {receiveTab === 'lightning' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-white/70 text-xs font-medium mb-2">
                      Amount ({currentMintUnit}s)
                    </label>
                    <input
                      type="text"
                      value={mintAmount}
                      onChange={(e) => handleAmountChange(e, 'receive')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleCreateMintQuote();
                        }
                      }}
                      className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white text-lg font-mono focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
                      placeholder="0"
                      autoFocus
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-1">
                    {[100, 500, 1000, 5000].map((amount) => (
                      <button
                        key={amount}
                        onClick={() => setMintAmount(amount.toString())}
                        className="py-1.5 px-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/70 text-xs transition-colors cursor-pointer"
                      >
                        {amount}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleCreateMintQuote}
                    disabled={!isValidReceiveAmount || (usingNip60 ? isNip60Processing : isMinting)}
                    className="w-full bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed border border-white/20 text-white py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {(usingNip60 ? isNip60Processing : isMinting) ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" />
                        Create Invoice
                      </>
                    )}
                  </button>
                </div>
              )}

              {receiveTab === 'token' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-white/70 text-xs font-medium mb-2">
                      Cashu Token
                    </label>
                    <textarea
                      value={tokenToImport}
                      onChange={(e) => setTokenToImport(e.target.value)}
                      className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white text-xs font-mono focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/20 min-h-[80px] resize-y"
                      placeholder="Paste a Cashu token here..."
                      autoFocus
                    />
                  </div>

                  <button
                    onClick={handleImportToken}
                    disabled={!tokenToImport.trim() || isImporting}
                    className="w-full bg-white/10 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed border border-white/20 text-white py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isImporting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                        Importing...
                      </>
                    ) : (
                      'Import Token'
                    )}
                  </button>

                  <div className="text-white/50 text-xs text-center">
                    Import a Cashu token to add sats to your wallet
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Activity Tab Content */}
          {activeTab === 'activity' && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-white/70 text-sm font-medium">Transaction History</span>
                <div className="flex items-center gap-2">
                  <span className="text-white/50 text-xs">{transactionHistory.length} transactions</span>
                  {transactionHistory.length > 0 && (
                    <button
                      onClick={handleClearHistory}
                      className="text-white/50 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-lg max-h-80 overflow-y-auto">
                {transactionHistory.length === 0 ? (
                  <div className="p-4 text-center text-white/50 text-sm">
                    No transactions yet
                  </div>
                ) : (
                  <div className="divide-y divide-white/10">
                    {[...transactionHistory].reverse().map((tx, index) => (
                      <div key={index} className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${
                            tx.type === 'send' || tx.type === 'spent' ? 'bg-red-500' : 'bg-green-500'
                          }`} />
                          <div>
                            <div className="text-sm font-medium text-white capitalize">{tx.type}</div>
                            <div className="text-xs text-white/50">
                              {new Date(tx.timestamp).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono text-white">
                            {tx.type === 'send' || tx.type === 'spent' ? '-' : '+'}
                            {tx.amount} sats
                          </div>
                          <div className="text-xs text-white/50">Balance: {tx.balance}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="pt-2 border-t border-white/10">
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white py-2 px-3 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open Full Wallet Settings
                </button>
              </div>
            </div>
                     )}

          {/* Invoice Tab Content */}
          {activeTab === 'invoice' && (
            <div className="p-3 space-y-3">
              {/* Back Button */}
              <button
                onClick={() => navigateToTab('receive')}
                className="text-white/70 hover:text-white transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              {(usingNip60 ? nip60Invoice : mintInvoice) ? (
                <div className="space-y-3">
                  {/* Amount Display */}
                  <div className="text-center">
                    <div className="text-white/60 text-sm">{mintAmount} {currentMintUnit}s</div>
                  </div>

                  {/* QR Code Display */}
                  <div className="bg-white/5 border border-white/20 rounded-lg p-3 flex items-center justify-center">
                    <div className="bg-white rounded-lg p-2">
                      <QRCode
                        value={usingNip60 ? nip60Invoice : mintInvoice}
                        size={120}
                        bgColor="#ffffff"
                        fgColor="#000000"
                      />
                    </div>
                  </div>

                  {/* Payment Status */}
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <div className="flex items-center justify-center gap-3">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-yellow-500/30 border-t-yellow-400" />
                      <div className="text-yellow-200 text-xs">Waiting for payment...</div>
                    </div>
                  </div>

                  {/* Invoice String Display */}
                  <div className="bg-white/5 border border-white/20 rounded-lg p-2">
                    <div className="font-mono text-xs text-white/70 break-all mb-2">
                      {(usingNip60 ? nip60Invoice : mintInvoice).length > 80 ? 
                        `${(usingNip60 ? nip60Invoice : mintInvoice).slice(0, 40)}...${(usingNip60 ? nip60Invoice : mintInvoice).slice(-40)}` : 
                        (usingNip60 ? nip60Invoice : mintInvoice)}
                    </div>
                    <button
                      onClick={() => copyToClipboard(usingNip60 ? nip60Invoice : mintInvoice, 'Invoice')}
                      className="w-full bg-white/10 hover:bg-white/15 border border-white/20 text-white py-1.5 px-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {copySuccess ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>

                  
                </div>
              ) : (
                <div className="text-center text-white/50 py-8">
                  <div className="text-sm">No invoice available</div>
                </div>
              )}
            </div>
          )}

          {/* Error/Success Messages */}
          {(error || successMessage) && (
            <div className="p-4 pt-0">
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-2 rounded-lg text-xs">
                  {error}
                </div>
              )}

              {successMessage && 
               !successMessage.includes('Invoice generated') && 
               successMessage !== 'Payment received! Tokens minted successfully.' && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-200 p-2 rounded-lg text-xs">
                  {successMessage}
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BalanceDisplay;
