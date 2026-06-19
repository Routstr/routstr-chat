"use client";

import React, { useCallback } from "react";
import { Zap, ClipboardPaste } from "lucide-react";
import { useChat } from "@/context/ChatProvider";
import BitcoinConnectStatusRow from "@/components/bitcoin-connect/BitcoinConnectStatusRow";
import { useWalletReceive } from "@/features/wallet/hooks/useWalletReceive";
import { toast } from "sonner";

interface ReceiveSectionProps {
  receive: ReturnType<typeof useWalletReceive>;
}

const subTabBase =
  "flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer";
const getSubTabClass = (isActive: boolean, extra = "") =>
  `${subTabBase} ${
    isActive
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:text-foreground/80"
  } ${extra}`.trim();

const ReceiveSection: React.FC<ReceiveSectionProps> = ({ receive }) => {
  const { currentMintUnit } = useChat();

  const isValidReceiveAmount = receive.mintAmount && parseInt(receive.mintAmount) > 0;

  const msatNote =
    currentMintUnit === "msat" ? (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
        <div className="text-blue-600 dark:text-blue-200 text-sm text-center">
          Note: You are using msats (millisats). 1 sat = 1000 msats
        </div>
      </div>
    ) : null;

  const handlePasteToken = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      receive.setTokenToImport(text);
    } catch {
      toast.error("Failed to read from clipboard");
    }
  }, [receive]);

  return (
    <div className="p-4 space-y-3">
      {msatNote}
      <div className="flex bg-muted/50 rounded-lg p-1">
        <button
          onClick={() => receive.setReceiveTab("lightning")}
          className={getSubTabClass(
            receive.receiveTab === "lightning",
            "flex items-center justify-center gap-2"
          )}
          type="button"
        >
          <Zap className="h-3 w-3" />
          Lightning
        </button>
        <button
          onClick={() => receive.setReceiveTab("token")}
          className={getSubTabClass(receive.receiveTab === "token")}
          type="button"
        >
          Token
        </button>
      </div>

      {receive.receiveTab === "lightning" && (
        <div className="space-y-3">
          <BitcoinConnectStatusRow
            status={receive.bcStatus}
            balance={receive.bcBalance}
            onConnect={receive.connectWallet}
          />
          <div>
            <label className="block text-muted-foreground text-xs font-medium mb-2">
              Amount ({currentMintUnit}s)
            </label>
            <input
              type="text"
              value={receive.mintAmount}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d+$/.test(v)) {
                  receive.setMintAmount(v);
                  receive.setError("");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void receive.handleCreateMintQuote();
                }
              }}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground text-lg font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="0"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-4 gap-1">
            {[100, 500, 1000, 5000].map((amount) => (
              <button
                key={amount}
                onClick={() => receive.setMintAmount(amount.toString())}
                className="py-1.5 px-2 bg-muted/50 hover:bg-muted border border-border rounded-md text-muted-foreground text-xs transition-colors cursor-pointer"
              >
                {amount}
              </button>
            ))}
          </div>

          <button
            onClick={receive.handleCreateMintQuote}
            disabled={!isValidReceiveAmount || receive.isNip60Processing}
            className="w-full bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {receive.isNip60Processing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
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

      {receive.receiveTab === "token" && (
        <div className="space-y-3">
          <div>
            <label className="block text-muted-foreground text-xs font-medium mb-2">
              Cashu Token
            </label>
            <div className="relative">
              <textarea
                value={receive.tokenToImport}
                onChange={(e) => receive.setTokenToImport(e.target.value)}
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 pr-10 text-foreground text-xs font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[80px] resize-y"
                placeholder="Paste a Cashu token here..."
                autoFocus
              />
              <button
                onClick={handlePasteToken}
                className="absolute top-2 right-2 bg-muted/60 hover:bg-muted border border-border text-foreground p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center"
                type="button"
                title="Paste"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <button
            onClick={receive.handleImportToken}
            disabled={!receive.tokenToImport.trim() || receive.isImporting}
            className="w-full bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {receive.isImporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                Importing...
              </>
            ) : (
              "Import Token"
            )}
          </button>

          <div className="text-muted-foreground text-xs text-center">
            Import a Cashu token to add sats to your wallet
          </div>
        </div>
      )}

      {(receive.error || receive.successMessage) && (
        <div>
          {receive.error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-200 p-2 rounded-lg text-xs">
              {receive.error}
            </div>
          )}
          {receive.successMessage && (
            <div className="bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-200 p-2 rounded-lg text-xs">
              {receive.successMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReceiveSection;
