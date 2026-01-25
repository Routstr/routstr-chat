"use client";
import React from "react";
import QRCode from "react-qr-code";
import { ModalShell } from "@/components/ui/ModalShell";
import { useBitcoinConnectStatus } from "@/hooks/useBitcoinConnect";
import BitcoinConnectStatusRow from "@/components/bitcoin-connect/BitcoinConnectStatusRow";
import CloseButton from "@/components/ui/CloseButton";

interface InvoiceModalProps {
  showInvoiceModal: boolean;
  mintInvoice: string;
  mintAmount: string;
  mintUnit: string;
  isAutoChecking: boolean;
  countdown: number;
  setShowInvoiceModal: (show: boolean) => void;
  setMintInvoice: (invoice: string) => void;
  setMintQuote: (quote: any) => void; // Use a more specific type if available
  checkIntervalRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null>;
  countdownIntervalRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null>;
  setIsAutoChecking: (checking: boolean) => void;
  onPayWithWallet?: (invoice: string) => Promise<void>;
  isPayingWithWallet?: boolean;
  showWalletConnect?: boolean;
}

const InvoiceModal: React.FC<InvoiceModalProps> = ({
  showInvoiceModal,
  mintInvoice,
  mintAmount,
  mintUnit,
  isAutoChecking,
  countdown,
  setShowInvoiceModal,
  setMintInvoice,
  setMintQuote,
  checkIntervalRef,
  countdownIntervalRef,
  setIsAutoChecking,
  onPayWithWallet,
  isPayingWithWallet,
  showWalletConnect,
}) => {
  if (!showInvoiceModal || !mintInvoice) return null;

  const {
    status: bcStatus,
    balance: bcBalance,
    connect: connectWallet,
  } = useBitcoinConnectStatus();

  return (
    <ModalShell
      open={showInvoiceModal && !!mintInvoice}
      onClose={() => setShowInvoiceModal(false)}
      overlayClassName="bg-black/80 z-50"
      contentClassName="bg-card rounded-lg max-w-md w-full m-4 border border-border max-h-[90vh] flex flex-col"
      closeOnOverlayClick
    >
      <div className="flex justify-between items-center p-4 border-b border-border shrink-0">
        <h3 className="text-lg font-semibold text-foreground">
          Lightning Invoice
        </h3>
        <CloseButton
          onClick={() => setShowInvoiceModal(false)}
          className="text-muted-foreground hover:text-foreground"
          iconClassName="h-5 w-5"
        />
      </div>

      <div className="p-6 space-y-4 overflow-y-auto">
        {showWalletConnect && (
          <BitcoinConnectStatusRow
            status={bcStatus}
            balance={bcBalance}
            onConnect={connectWallet}
            className="rounded-md p-3"
          />
        )}

        <div className="bg-muted border border-border p-4 rounded-md flex items-center justify-center">
          <div className="w-56 h-56 flex items-center justify-center p-2 rounded-md">
            <QRCode
              value={mintInvoice}
              size={220}
              bgColor="transparent"
              fgColor="currentColor"
              className="text-foreground"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Amount</span>
            <span className="text-sm font-medium text-foreground">
              {mintAmount} {mintUnit}s
            </span>
          </div>

          {isAutoChecking && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 flex items-center justify-between">
              <span className="text-xs text-yellow-600 dark:text-yellow-200">
                After payment, tokens will be automatically minted
              </span>
              <span className="text-xs text-yellow-600 dark:text-yellow-200 flex items-center">
                {countdown}s
                <svg className="ml-2 w-3 h-3 animate-spin" viewBox="0 0 24 24">
                  <path
                    d="M21 12a9 9 0 1 1-6.219-8.56"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </span>
            </div>
          )}

          <div className="mt-2">
            <div className="text-xs text-muted-foreground mb-1">
              Lightning Invoice
            </div>
            <div className="font-mono text-xs text-muted-foreground bg-muted/50 border border-border rounded-md p-3 break-all">
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
              className="flex-1 px-4 py-2 bg-muted/50 hover:bg-muted border border-border text-foreground rounded-md text-sm transition-colors cursor-pointer"
              type="button"
            >
              Copy Invoice
            </button>
            {onPayWithWallet && (
              <button
                onClick={() => {
                  void onPayWithWallet(mintInvoice);
                }}
                disabled={!!isPayingWithWallet}
                className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 border border-border text-foreground rounded-md text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
              >
                {isPayingWithWallet ? (
                  <>
                    <svg
                      className="inline mr-2 h-3 w-3 animate-spin"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M21 12a9 9 0 1 1-6.219-8.56"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        fill="none"
                      />
                    </svg>
                    Paying...
                  </>
                ) : (
                  "Pay with wallet"
                )}
              </button>
            )}
            <button
              onClick={() => {
                setShowInvoiceModal(false);
                setMintInvoice("");
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
              className="flex-1 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-md text-sm transition-colors cursor-pointer"
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

export default InvoiceModal;
