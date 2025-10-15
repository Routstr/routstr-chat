'use client';

import React, { useEffect, useRef, useState } from 'react';
import { QrCode } from 'lucide-react';
import QRCode from 'react-qr-code';
import { Drawer } from 'vaul';
import { useCashuWallet, useCashuToken, useCashuStore, useTransactionHistoryStore, formatBalance } from '@/features/wallet';
import { useInvoiceSync } from '@/hooks/useInvoiceSync';
import { PendingTransaction } from '@/features/wallet/state/transactionHistoryStore';
import { createLightningInvoice, mintTokensFromPaidInvoice } from '@/lib/cashuLightning';
import { MintQuoteState } from '@cashu/cashu-ts';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface TopUpPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTopUp: (amount?: number) => void;
  onDontShowAgain: () => void;
}

const TopUpPromptModal: React.FC<TopUpPromptModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [invoice, setInvoice] = useState('');
  const [quoteId, setQuoteId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const { updateProofs } = useCashuWallet();
  const { error: tokenError } = useCashuToken();
  const cashuStore = useCashuStore();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const transactionHistoryStore = useTransactionHistoryStore();
  const isMobile = useMediaQuery('(max-width: 640px)');

  // Prevent hydration mismatch by waiting for client-side hydration
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !isHydrated) return null;

  const quickAmounts = [500, 1000, 5000];

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

  const handleCreateInvoice = async (amount?: number) => {
    if (!cashuStore.activeMintUrl) {
      setError('No active mint selected.');
      return;
    }

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

  const modalContent = (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Top Up with Lightning⚡</h2>

      {/* QR / placeholder - match DepositModal style */}
      <div className="bg-white/10 border border-white/20 p-4 rounded-md flex items-center justify-center">
        <div
          className={`w-48 h-48 flex items-center justify-center p-2 rounded-md ${invoice ? 'cursor-pointer hover:bg-white/5 transition-colors' : ''}`}
          onClick={invoice ? copyInvoiceToClipboard : undefined}
          role={invoice ? 'button' as const : undefined}
          title={invoice ? 'Click to copy invoice' : undefined}
        >
          {invoice ? (
            <QRCode value={invoice} size={180} bgColor="transparent" fgColor="#ffffff" />
          ) : (
            <QrCode className="h-8 w-8 text-white/30" />
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {quickAmounts.map(a => (
          <button
            key={a}
            onClick={() => { void handleCreateInvoice(a); }}
            className="flex-1 bg-white/5 border border-white/20 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-white/10 hover:border-white/30 transition-colors cursor-pointer"
            type="button"
          >
            {a}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          inputMode="numeric"
          placeholder="Amount (sats)"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCreateInvoice();
            }
          }}
          className="flex-1 bg-white/5 border border-white/20 rounded-md px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
        />
        <button
          onClick={() => { void handleCreateInvoice(); }}
          className="bg-white/10 border border-white/20 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-white/15 transition-colors cursor-pointer"
          type="button"
        >
          {isProcessing ? 'Creating...' : 'Get invoice'}
        </button>
      </div>

      {invoice && (
        <div className="text-white/50 text-xs text-center">Waiting for payment...</div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 p-2 rounded-md text-xs">{error}</div>
      )}

      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-200 p-2 rounded-md text-xs">{successMessage}</div>
      )}
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} className="bg-[#181818] border border-white/20 rounded-md p-5 max-w-sm w-full relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-white/50 hover:text-white"
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


