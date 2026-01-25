"use client";

import React from "react";
import { Check, Copy } from "lucide-react";
import QRCode from "react-qr-code";
import BitcoinConnectStatusRow from "@/components/bitcoin-connect/BitcoinConnectStatusRow";
import type { BitcoinConnectStatus } from "@/hooks/useBitcoinConnect";

interface BalanceInvoiceTabProps {
  onBack: () => void;
  bcStatus: BitcoinConnectStatus;
  bcBalance: number | null;
  onConnectWallet: () => void | Promise<void>;
  usingNip60: boolean;
  nip60Invoice: string;
  mintInvoice: string;
  mintAmount: string;
  currentMintUnit: string;
  onShowQRCode: (data: {
    invoice: string;
    amount: string;
    unit: string;
  }) => void;
  onPayWithWallet: () => void;
  isPayingWithWallet: boolean;
  copyToClipboard: (text: string, type?: string) => void;
  copySuccess: boolean;
}

const BalanceInvoiceTab: React.FC<BalanceInvoiceTabProps> = ({
  onBack,
  bcStatus,
  bcBalance,
  onConnectWallet,
  usingNip60,
  nip60Invoice,
  mintInvoice,
  mintAmount,
  currentMintUnit,
  onShowQRCode,
  onPayWithWallet,
  isPayingWithWallet,
  copyToClipboard,
  copySuccess,
}) => {
  const invoice = usingNip60 ? nip60Invoice : mintInvoice;

  return (
    <div className="p-3 space-y-3">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        type="button"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </button>

      {/* NWC Wallet row */}
      <BitcoinConnectStatusRow
        status={bcStatus}
        balance={bcBalance}
        onConnect={onConnectWallet}
      />

      {invoice ? (
        <div className="space-y-3">
          {/* Amount Display */}
          <div className="text-center">
            <div className="text-muted-foreground text-sm">
              {mintAmount} {currentMintUnit}s
            </div>
          </div>

          {/* QR Code Display */}
          <div className="relative">
            <div
              className="bg-muted/50 border border-border rounded-lg p-3 flex items-center justify-center cursor-pointer hover:bg-muted transition-colors"
              onClick={() =>
                onShowQRCode({
                  invoice,
                  amount: mintAmount,
                  unit: currentMintUnit,
                })
              }
              role="button"
              title="Click to zoom QR code"
            >
              <div className="bg-white rounded-lg p-2">
                <QRCode
                  value={invoice}
                  size={120}
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
            </div>
            {/* Zoom hint */}
            <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm border border-border rounded-md px-2 py-1 flex items-center gap-1 pointer-events-none">
              <svg
                className="h-3 w-3 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
                />
              </svg>
              <span className="text-muted-foreground text-xs">Zoom</span>
            </div>
          </div>

          {/* Payment Status */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <div className="flex items-center justify-center gap-3">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-yellow-500/30 border-t-yellow-400" />
              <div className="text-yellow-600 dark:text-yellow-200 text-xs">
                Waiting for payment...
              </div>
            </div>
          </div>

          {/* Pay with wallet */}
          <button
            onClick={onPayWithWallet}
            disabled={isPayingWithWallet || bcStatus !== "connected"}
            className="w-full bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
            type="button"
          >
            {isPayingWithWallet ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                Paying...
              </>
            ) : (
              "Pay with wallet"
            )}
          </button>

          {/* Invoice String Display */}
          <div className="bg-muted/50 border border-border rounded-lg p-2">
            <div className="font-mono text-xs text-muted-foreground break-all mb-2">
              {invoice.length > 80
                ? `${invoice.slice(0, 40)}...${invoice.slice(-40)}`
                : invoice}
            </div>
            <button
              onClick={() => copyToClipboard(invoice, "Invoice")}
              className="w-full bg-muted hover:bg-muted/80 border border-border text-foreground py-1.5 px-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
              type="button"
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
        <div className="text-center text-muted-foreground py-8">
          <div className="text-sm">No invoice available</div>
        </div>
      )}
    </div>
  );
};

export default BalanceInvoiceTab;
