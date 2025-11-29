'use client';

import React, { useEffect, useState } from 'react';
import { QrCode, ClipboardPaste } from 'lucide-react';
import QRCode from 'react-qr-code';
import { Drawer } from 'vaul';
import { useCashuWallet, useCashuStore, useTransactionHistoryStore, formatBalance, useCashuToken } from '@/features/wallet';
import { useInvoiceSync } from '@/hooks/useInvoiceSync';
import { PendingTransaction } from '@/features/wallet/state/transactionHistoryStore';
import { createLightningInvoice, mintTokensFromPaidInvoice } from '@/lib/cashuLightning';
import { MintQuoteState, getDecodedToken } from '@cashu/cashu-ts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNostrLogin } from '@nostrify/react/login';
import { useLoginActions } from '@/hooks/useLoginActions';
import { generateSecretKey, nip19 } from 'nostr-tools';
import { useAuth } from '@/context/AuthProvider';
import { markEphemeralNsecCreated } from '@/utils/storageUtils';

interface TopUpPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTopUp: (amount?: number) => void;
  onDontShowAgain: () => void;
  setIsLoginModalOpen: (open: boolean) => void;
}

const TopUpPromptModal: React.FC<TopUpPromptModalProps> = ({ isOpen, onClose, onDontShowAgain, setIsLoginModalOpen }) => {
  const [customAmount, setCustomAmount] = useState('');
  const [invoice, setInvoice] = useState('');
  const [quoteId, setQuoteId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);

  const { updateProofs } = useCashuWallet();
  const cashuStore = useCashuStore();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const transactionHistoryStore = useTransactionHistoryStore();
  const { receiveToken } = useCashuToken();
  const isMobile = useMediaQuery('(max-width: 640px)');
  const [bcStatus, setBcStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [bcBalance, setBcBalance] = useState<number | null>(null);
  const [cashuToken, setCashuToken] = useState('');
  const [isReceivingToken, setIsReceivingToken] = useState(false);
  const [activeTab, setActiveTab] = useState<'lightning' | 'token' | 'wallet'>('lightning');
  const [nwcCustomAmount, setNwcCustomAmount] = useState('');
  const [isPayingWithNWC, setIsPayingWithNWC] = useState(false);


  const { logins } = useNostrLogin();
  const loginActions = useLoginActions();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    let unsubConnect: undefined | (() => void);
    let unsubDisconnect: undefined | (() => void);
    let unsubConnecting: undefined | (() => void);

    (async () => {
      try {
        const mod = await import('@getalby/bitcoin-connect-react');
        const fetchBalance = async (provider: any): Promise<number | null> => {
          try {
            if (provider && typeof provider.getBalance === 'function') {
              const res = await provider.getBalance();
              if (typeof res === 'number') return res;
              if (res && typeof res === 'object') {
                if ('balance' in res && typeof (res as any).balance === 'number') {
                  const unit = ((res as any).unit || '').toString().toLowerCase();
                  const n = (res as any).balance as number;
                  return unit.includes('msat') ? Math.floor(n / 1000) : n;
                }
                if ('balanceMsats' in res && typeof (res as any).balanceMsats === 'number') {
                  return Math.floor((res as any).balanceMsats / 1000);
                }
              }
            }
          } catch {}
          return null;
        };

        unsubConnecting = mod.onConnecting?.(() => setBcStatus('connecting'));
        unsubConnect = mod.onConnected?.(async (provider: any) => {
          setBcStatus('connected');
          const sats = await fetchBalance(provider);
          if (sats !== null) setBcBalance(sats);
        });
        unsubDisconnect = mod.onDisconnected?.(() => {
          setBcStatus('disconnected');
          setBcBalance(null);
        });

        try {
          const cfg = mod.getConnectorConfig?.();
          if (cfg) {
            setBcStatus('connected');
            try {
              const provider = await mod.requestProvider();
              const sats = await fetchBalance(provider);
              if (sats !== null) setBcBalance(sats);
            } catch {}
          }
        } catch {}
      } catch {}
    })();

    return () => {
      try { unsubConnect && unsubConnect(); } catch {}
      try { unsubDisconnect && unsubDisconnect(); } catch {}
      try { unsubConnecting && unsubConnecting(); } catch {}
    };
  }, []);

  // Prevent hydration mismatch by waiting for client-side hydration
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  if (!isOpen || !isHydrated) return null;

  const quickAmounts = [500, 1000, 5000];

  const createNsecForLogin = () => {
    const sk = generateSecretKey();
    const nsec = nip19.nsecEncode(sk);
    console.log("RTRUE nsse", nsec)
    loginActions.nsec(nsec);
    markEphemeralNsecCreated()
  }

  const copyInvoiceToClipboard = async () => {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice);
      setSuccessMessage('Invoice copied to clipboard');
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch (e) {
      setError('Failed to copy invoice');
      setTimeout(() => setError(null), 2000);
    }
  };

  const handlePasteToken = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCashuToken(text);
    } catch (e) {
      setError('Failed to read from clipboard');
      setTimeout(() => setError(null), 2000);
    }
  };

  const handleReceiveToken = async () => {
    if (!cashuToken.trim()) {
      setError('Please paste a cashu token');
      setTimeout(() => setError(null), 2000);
      return;
    }
    
    createNsecForLogin()

    try {
      setIsReceivingToken(true);
      setError(null);
      
      // Decode token to get original amount and unit for display
      const decodedToken = getDecodedToken(cashuToken.trim());
      if (!decodedToken) {
        throw new Error('Invalid token format');
      }
      
      const tokenUnit = decodedToken.unit || 'sat';
      // Calculate total from original token proofs
      const originalTotalAmount = decodedToken.proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
      
      // Receive the token
      await receiveToken(cashuToken.trim());
      
      // Convert msat to sat for display consistency
      const displayAmount = tokenUnit === 'msat' ? Math.floor(originalTotalAmount / 1000) : originalTotalAmount;
      
      setSuccessMessage(`Received ${formatBalance(displayAmount, 'sats')}!`);
      setCashuToken('');
      setTimeout(() => {
        setSuccessMessage(null);
        onClose();
      }, 2000);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to receive token';
      setError(message);
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsReceivingToken(false);
    }
  };

  const handleCreateInvoice = async (amount?: number) => {
    if (!cashuStore.activeMintUrl) {
      setError('No active mint selected.');
      return;
    }

    createNsecForLogin()

    const amt = amount !== undefined ? amount : parseInt(customAmount);
    if (isNaN(amt) || amt <= 0) {
      setError('Enter a valid amount');
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);

      const invoiceData = await createLightningInvoice(cashuStore.activeMintUrl, amt);
      setInvoice(invoiceData.paymentRequest);
      setQuoteId(invoiceData.quoteId);
      setPendingAmount(amt);

      await addInvoice({
        type: 'mint',
        mintUrl: cashuStore.activeMintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
        amount: amt,
        state: MintQuoteState.UNPAID,
        expiresAt: invoiceData.expiresAt
      });

      const pendingId = crypto.randomUUID();
      const pendingTx: PendingTransaction = {
        id: pendingId,
        direction: 'in',
        amount: amt.toString(),
        timestamp: Math.floor(Date.now() / 1000),
        status: 'pending',
        mintUrl: cashuStore.activeMintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
      };
      transactionHistoryStore.addPendingTransaction(pendingTx);
      setPendingTransactionId(pendingId);

      void checkPaymentStatus(cashuStore.activeMintUrl, invoiceData.quoteId, amt, pendingId);
    } catch (e) {
      console.error('Error creating invoice:', e);
      setError('Failed to create invoice');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaid = async (_response: any) => {
    if (!cashuStore.activeMintUrl || !quoteId || !pendingAmount) return;
    try {
      const proofs = await mintTokensFromPaidInvoice(cashuStore.activeMintUrl, quoteId, pendingAmount);
      if (proofs.length > 0) {
        await updateProofs({ mintUrl: cashuStore.activeMintUrl, proofsToAdd: proofs, proofsToRemove: [] });
        await updateInvoice(quoteId, { state: MintQuoteState.PAID, paidAt: Date.now() });
        if (pendingTransactionId) transactionHistoryStore.removePendingTransaction(pendingTransactionId);
        setPendingTransactionId(null);
        setSuccessMessage(`Received ${formatBalance(pendingAmount, 'sats')}!`);
        setInvoice('');
        setQuoteId('');
        setPendingAmount(null);
      }
    } catch (_e) {
      // Fallback to existing polling which is already in progress
    }
  };

  const checkPaymentStatus = async (mintUrl: string, qid: string, amt: number, pendingId: string) => {
    try {
      const proofs = await mintTokensFromPaidInvoice(mintUrl, qid, amt);
      if (proofs.length > 0) {
        await updateProofs({ mintUrl, proofsToAdd: proofs, proofsToRemove: [] });
        await updateInvoice(qid, { state: MintQuoteState.PAID, paidAt: Date.now() });
        transactionHistoryStore.removePendingTransaction(pendingId);
        setPendingTransactionId(null);
        setSuccessMessage(`Received ${formatBalance(amt, 'sats')}!`);
        setTimeout(() => setSuccessMessage(null), 4000);
        return;
      }
      setTimeout(() => {
        if (quoteId === qid) {
          void checkPaymentStatus(mintUrl, qid, amt, pendingId);
        }
      }, 5000);
    } catch (e) {
      if (!(e instanceof Error && e.message.includes('not been paid'))) {
        console.error('Error checking payment:', e);
        setError('Failed to check payment');
      } else {
        setTimeout(() => {
          if (quoteId === qid) {
            void checkPaymentStatus(mintUrl, qid, amt, pendingId);
          }
        }, 5000);
      }
    }
  };

  const handlePayWithNWC = async (amount?: number) => {
    if (bcStatus !== 'connected') {
      setError('Please connect your wallet first');
      return;
    }

    if (!cashuStore.activeMintUrl) {
      setError('No active mint selected.');
      return;
    }

    const amt = amount !== undefined ? amount : parseInt(nwcCustomAmount);
    if (isNaN(amt) || amt <= 0) {
      setError('Enter a valid amount');
      return;
    }

    try {
      setIsPayingWithNWC(true);
      setError(null);

      // Create invoice
      const invoiceData = await createLightningInvoice(cashuStore.activeMintUrl, amt);
      const paymentRequest = invoiceData.paymentRequest;
      const qid = invoiceData.quoteId;

      await addInvoice({
        type: 'mint',
        mintUrl: cashuStore.activeMintUrl,
        quoteId: qid,
        paymentRequest,
        amount: amt,
        state: MintQuoteState.UNPAID,
        expiresAt: invoiceData.expiresAt
      });

      const pendingId = crypto.randomUUID();
      const pendingTx: PendingTransaction = {
        id: pendingId,
        direction: 'in',
        amount: amt.toString(),
        timestamp: Math.floor(Date.now() / 1000),
        status: 'pending',
        mintUrl: cashuStore.activeMintUrl,
        quoteId: qid,
        paymentRequest,
      };
      transactionHistoryStore.addPendingTransaction(pendingTx);

      // Pay with connected wallet
      try {
        const mod = await import('@getalby/bitcoin-connect-react');
        const provider = await mod.requestProvider();
        const res = await provider.sendPayment(paymentRequest);
        
        // Check payment status and update proofs
        if (res && (res as any).preimage) {
          const proofs = await mintTokensFromPaidInvoice(cashuStore.activeMintUrl, qid, amt);
          if (proofs.length > 0) {
            await updateProofs({ mintUrl: cashuStore.activeMintUrl, proofsToAdd: proofs, proofsToRemove: [] });
            await updateInvoice(qid, { state: MintQuoteState.PAID, paidAt: Date.now() });
            transactionHistoryStore.removePendingTransaction(pendingId);
            setSuccessMessage(`Received ${formatBalance(amt, 'sats')}!`);
            setNwcCustomAmount('');
            setTimeout(() => {
              setSuccessMessage(null);
              onClose();
            }, 2000);
          } else {
            // Start polling if proofs not immediately available
            void checkPaymentStatus(cashuStore.activeMintUrl, qid, amt, pendingId);
          }
        } else {
          // Start polling
          void checkPaymentStatus(cashuStore.activeMintUrl, qid, amt, pendingId);
        }
      } catch (paymentError) {
        console.error('Error paying with NWC:', paymentError);
        setError('Payment failed. Please try again.');
        void checkPaymentStatus(cashuStore.activeMintUrl, qid, amt, pendingId);
      }
    } catch (e) {
      console.error('Error creating invoice:', e);
      setError('Failed to create invoice');
    } finally {
      setIsPayingWithNWC(false);
    }
  };

  const modalContent = (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Top Up</h2>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        <button
          onClick={() => setActiveTab('lightning')}
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'lightning'
              ? 'text-white border-b-2 border-white'
              : 'text-white/50 hover:text-white/70'
          }`}
          type="button"
        >
          Lightning
        </button>
        <button
          onClick={() => setActiveTab('token')}
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'token'
              ? 'text-white border-b-2 border-white'
              : 'text-white/50 hover:text-white/70'
          }`}
          type="button"
        >
          Token
        </button>
        <button
          onClick={() => setActiveTab('wallet')}
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'wallet'
              ? 'text-white border-b-2 border-white'
              : 'text-white/50 hover:text-white/70'
          }`}
          type="button"
        >
          NWC
        </button>
      </div>

      {/* Tab Content Container */}
      <div className="">
      {/* Lightning Tab */}
      {activeTab === 'lightning' && (
        <div className="space-y-4">
          {/* QR / placeholder */}
          <div className="bg-white/10 border border-white/20 p-6 rounded-lg flex items-center justify-center">
            <div
              className={`w-48 h-48 flex items-center justify-center p-2 rounded-lg ${invoice ? 'cursor-pointer hover:bg-white/5 transition-all' : ''}`}
              onClick={invoice ? copyInvoiceToClipboard : undefined}
              role={invoice ? 'button' as const : undefined}
              title={invoice ? 'Click to copy invoice' : undefined}
            >
              {invoice ? (
                <QRCode value={invoice} size={180} bgColor="transparent" fgColor="#ffffff" />
              ) : (
                <QrCode className="h-10 w-10 text-white/30" />
              )}
            </div>
          </div>

          {invoice && (
            <button
              onClick={copyInvoiceToClipboard}
              className="w-full px-4 py-2 text-sm bg-white/10 hover:bg-white/15 border border-white/20 rounded-lg text-white transition-all"
              type="button"
            >
              Copy Invoice
            </button>
          )}

          <div className="flex gap-2">
            {quickAmounts.map(a => (
              <button
                key={a}
                onClick={() => { void handleCreateInvoice(a); }}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/20 hover:border-white/30 text-white px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer"
                type="button"
              >
                {a} sats
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Custom amount (sats)"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreateInvoice();
                }
              }}
              className="flex-1 bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all"
            />
            <button
              onClick={() => { void handleCreateInvoice(); }}
              className="bg-white/10 hover:bg-white/15 border border-white/20 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer"
              type="button"
            >
              {isProcessing ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                  </svg>
                  Creating...
                </span>
              ) : (
                'Get Invoice'
              )}
            </button>
          </div>

        </div>
      )}

      {/* Token Tab */}
      {activeTab === 'token' && (
        <div className="flex flex-col justify-center h-full">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Paste Cashu Token
              </label>
              <div className="relative">
                <textarea
                  value={cashuToken}
                  onChange={(e) => setCashuToken(e.target.value)}
                  placeholder="Paste your cashu token here..."
                  className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none transition-all"
                  rows={10}
                />
                <button
                  onClick={handlePasteToken}
                  className="absolute top-3 right-3 bg-white/10 hover:bg-white/15 border border-white/20 text-white p-2 rounded-md transition-all cursor-pointer flex items-center justify-center"
                  type="button"
                  title="Paste from clipboard"
                >
                  <ClipboardPaste className="h-4 w-4" />
                </button>
              </div>
            </div>
            <button
              onClick={() => { void handleReceiveToken(); }}
              disabled={isReceivingToken || !cashuToken.trim()}
              className="w-full bg-white/10 hover:bg-white/15 border border-white/20 text-white px-4 py-3 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/10"
              type="button"
            >
              {isReceivingToken ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                  </svg>
                  Receiving...
                </span>
              ) : (
                'Receive Token'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Wallet Tab */}
      {activeTab === 'wallet' && (
        <div className="space-y-4">
          <div className="bg-white/5 border border-white/20 rounded-lg p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="text-sm font-medium text-white/70 block">Wallet (NWC)</span>
                {bcStatus === 'connected' && bcBalance !== null && (
                  <span className="text-xs text-white/50 mt-1 block">{bcBalance.toLocaleString()} sats</span>
                )}
              </div>
              {bcStatus === 'connected' ? (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 bg-green-400 rounded-full"></div>
                  <span className="text-sm text-green-400 font-medium">Connected</span>
                </div>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      createNsecForLogin();
                      const mod = await import('@getalby/bitcoin-connect-react');
                      mod.launchModal();
                    } catch {}
                  }}
                  className="px-4 py-2 text-sm bg-white/10 hover:bg-white/15 border border-white/20 rounded-lg text-white transition-all"
                  type="button"
                >
                  {bcStatus === 'connecting' ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                      </svg>
                      Connecting…
                    </span>
                  ) : (
                    'Connect Wallet'
                  )}
                </button>
              )}
            </div>
          </div>

          {bcStatus === 'connected' && (
            <>
              <div className="flex gap-2">
                {quickAmounts.map(a => (
                  <button
                    key={a}
                    onClick={() => { void handlePayWithNWC(a); }}
                    disabled={isPayingWithNWC}
                    className="flex-1 bg-white/5 hover:bg-white/10 border border-white/20 hover:border-white/30 text-white px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/5"
                    type="button"
                  >
                    {a} sats
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Custom amount (sats)"
                  value={nwcCustomAmount}
                  onChange={(e) => setNwcCustomAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handlePayWithNWC();
                    }
                  }}
                  disabled={isPayingWithNWC}
                  className="flex-1 bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={() => { void handlePayWithNWC(); }}
                  disabled={isPayingWithNWC || !nwcCustomAmount.trim()}
                  className="bg-white/10 hover:bg-white/15 border border-white/20 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/10"
                  type="button"
                >
                  {isPayingWithNWC ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                      </svg>
                      Paying...
                    </span>
                  ) : (
                    'Pay'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-3 rounded-lg text-sm">{error}</div>
      )}

      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-200 p-3 rounded-lg text-sm">{successMessage}</div>
      )}

      {/* OR separator */}
      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/20"></div>
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[#181818] px-1 text-lg font-bold text-white/90">OR</span>
        </div>
      </div>

      {/* Login button */}
      <div className="pt-2">
        <button
          onClick={() => { onClose(); setIsLoginModalOpen(true); }}
          className="w-full bg-white/10 border border-white/20 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors cursor-pointer"
          type="button"
        >
          Login
        </button>
      </div>

      {/* Don't show again action */}
      <div className="flex justify-end pt-2 border-t border-white/10">
        <button
          onClick={() => { onDontShowAgain(); onClose(); }}
          className="text-xs text-white/50 hover:text-white/80"
          type="button"
        >
          Don't show again
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-[60]" />
          <Drawer.Content className="bg-[#181818] flex flex-col rounded-t-[10px] mt-24 h-[80%] lg:h-fit max-h-[96%] fixed bottom-0 left-0 right-0 outline-none z-[60]">
            <div className="pt-4 pb-4 bg-[#181818] rounded-t-[10px] flex-1 overflow-y-auto">
              <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-white/20 mb-8" aria-hidden />
              <Drawer.Title className="sr-only">Top up</Drawer.Title>
              <div className="max-w-sm mx-auto px-5 flex flex-col h-full">
                {modalContent}
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-[#181818] border border-white/20 rounded-md p-5 max-w-sm w-full relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-white/50 hover:text-white transition-colors cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {modalContent}
      </div>
    </div>
  );
};

export default TopUpPromptModal;


