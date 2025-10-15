import { useCallback, useRef } from 'react';
import { CashuMint, CashuWallet, MintQuoteState } from '@cashu/cashu-ts';
import { TransactionHistory } from '@/types/chat';
import { fetchBalances } from '@/utils/cashuUtils';
import { useInvoiceSync } from '@/hooks/useInvoiceSync';

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

interface UseWalletOperationsProps {
  mintUrl: string;
  baseUrl: string;
  setBalance: (balance: number | ((prevBalance: number) => number)) => void;
  setTransactionHistory: (transactionHistory: TransactionHistory[] | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])) => void;
  transactionHistory: TransactionHistory[];
}

export function useWalletOperations({
  mintUrl,
  baseUrl,
  setBalance,
  setTransactionHistory,
  transactionHistory
}: UseWalletOperationsProps) {
  const cashuWalletRef = useRef<CashuWallet | null>(null);
  const mintQuoteRef = useRef<MintQuoteResponse | null>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { addInvoice, updateInvoice } = useInvoiceSync();

  // Initialize wallet
  const initWallet = useCallback(async () => {
    try {
      const mint = new CashuMint(mintUrl);
      const keysets = await mint.getKeySets();
      
      // Get preferred unit: msat over sat if both are active
      const activeKeysets = keysets.keysets.filter(k => k.active);
      const units = [...new Set(activeKeysets.map(k => k.unit))];
      const preferredUnit = units.includes('msat') ? 'msat' : (units.includes('sat') ? 'sat' : 'not supported');
      
      const wallet = new CashuWallet(mint, { unit: preferredUnit });
      await wallet.loadMint();
      cashuWalletRef.current = wallet;
      return wallet;
    } catch (error) {
      throw new Error('Failed to initialize wallet. Please try again.');
    }
  }, [mintUrl]);

  // Check mint quote
  const checkMintQuote = useCallback(async (isAutoChecking: boolean, setIsAutoChecking: (checking: boolean) => void, mintAmount: string, setError: (error: string) => void, setSuccessMessage: (message: string) => void, setShowInvoiceModal: (show: boolean) => void, setMintQuote: (quote: MintQuoteResponse | null) => void, setMintInvoice: (invoice: string) => void, countdown: number, setCountdown: (countdown: number) => void) => {
    if (!cashuWalletRef.current || !mintQuoteRef.current) return;

    if (!isAutoChecking) {
      setIsAutoChecking(true);
    }
    setError('');

    try {
      const checkedQuote = await cashuWalletRef.current.checkMintQuote(mintQuoteRef.current.quote);
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
          const proofs = await cashuWalletRef.current.mintProofs(amount, mintQuoteRef.current.quote);

          const storedProofs = localStorage.getItem('cashu_proofs');
          const existingProofs = storedProofs ? (JSON.parse(storedProofs) as CashuProof[]) : [];
          localStorage.setItem('cashu_proofs', JSON.stringify([...existingProofs, ...proofs]));

          const newBalance = existingProofs.reduce((total, proof) => total + proof.amount, 0) +
            proofs.reduce((total, proof) => total + proof.amount, 0);

          const {apiBalance, proofsBalance} = await fetchBalances(mintUrl, baseUrl);
          setBalance((apiBalance / 1000) + newBalance)
          
          // Update invoice status to paid
          if (mintQuoteRef.current) {
            await updateInvoice(mintQuoteRef.current.quote, {
              state: MintQuoteState.PAID,
              paidAt: Date.now()
            });
          }

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
          mintQuoteRef.current = null;
          setMintInvoice('');
        } catch (mintError) {
         const err = mintError as Error;
          if (err?.message?.includes('already spent') ||
            err?.message?.includes('Token already spent')) {
            setError('This token has already been spent.');
          } else if (err?.message?.includes('already issued') ||
            err?.message?.includes('already minted')) {
              
            const balances = await fetchBalances(mintUrl, baseUrl);
            const apiBalance = balances.apiBalance;
            const proofsBalance = balances.proofsBalance;
            setBalance((apiBalance / 1000) + (proofsBalance / 1000)); //balances returned in mSats
            setSuccessMessage('Payment already processed! Your balance has been updated.');
            setShowInvoiceModal(false);
            setMintQuote(null);
            mintQuoteRef.current = null;
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
  }, [mintUrl, baseUrl, setBalance, transactionHistory, setTransactionHistory, updateInvoice]);

  // Create mint quote
  const createMintQuote = useCallback(async (setIsMinting: (minting: boolean) => void, setError: (error: string) => void, setSuccessMessage: (message: string) => void, setShowInvoiceModal: (show: boolean) => void, mintAmount: string, setMintQuote: (quote: MintQuoteResponse | null) => void, setMintInvoice: (invoice: string) => void, amountOverride?: number) => {
    if (!cashuWalletRef.current) return;

    setIsMinting(true);
    setError('');
    setSuccessMessage('');

    try {
      const amount = amountOverride ?? parseInt(mintAmount, 10);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Please enter a valid amount');
      }

      const quote = await cashuWalletRef.current.createMintQuote(amount);
      setMintQuote(quote);
      mintQuoteRef.current = quote;
      setMintInvoice(quote.request || '');
      
      // Store invoice persistently
      await addInvoice({
        type: 'mint',
        mintUrl: mintUrl,
        quoteId: quote.quote,
        paymentRequest: quote.request || '',
        amount: amount,
        state: MintQuoteState.UNPAID,
        expiresAt: quote.expiry ? quote.expiry * 1000 : undefined
      });
      
      setSuccessMessage('Invoice generated! Pay it to mint tokens.');
      setShowInvoiceModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mint quote');
    } finally {
      setIsMinting(false);
    }
  }, [mintUrl, addInvoice]);

  // Import token
  const importToken = useCallback(async (setIsImporting: (importing: boolean) => void, setError: (error: string) => void, setSuccessMessage: (message: string) => void, tokenToImport: string, setTokenToImport: (token: string) => void) => {
    if (!cashuWalletRef.current || !tokenToImport.trim()) return;

    setIsImporting(true);
    setError('');
    setSuccessMessage('');

    try {
      const result = await cashuWalletRef.current.receive(tokenToImport);
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
  }, [mintUrl, baseUrl, setBalance, transactionHistory, setTransactionHistory]);

  // Generate send token
  const generateSendToken = useCallback(async (setIsGeneratingSendToken: (generating: boolean) => void, setError: (error: string) => void, setSuccessMessage: (message: string) => void, sendAmount: string, balance: number, setSendAmount: (amount: string) => void, setGeneratedToken: (token: string) => void) => {
    if (!cashuWalletRef.current) return;

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

      const sendResult = await cashuWalletRef.current.send(amount, existingProofs);
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
  }, [mintUrl, baseUrl, setBalance, transactionHistory, setTransactionHistory]);

  // Set up auto-refresh interval when invoice is generated
  const setupAutoRefresh = useCallback((mintInvoice: string, mintQuote: MintQuoteResponse | null, checkMintQuote: () => Promise<void>, isAutoChecking: boolean, setIsAutoChecking: (checking: boolean) => void, countdown: number, setCountdown: (countdown: number | ((prev: number) => number)) => void) => {
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
        setCountdown((prev: number) => {
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
  }, [checkMintQuote]);

  return {
    initWallet,
    checkMintQuote,
    createMintQuote,
    importToken,
    generateSendToken,
    setupAutoRefresh,
    cashuWalletRef,
    mintQuoteRef,
    checkIntervalRef,
    countdownIntervalRef
  };
}