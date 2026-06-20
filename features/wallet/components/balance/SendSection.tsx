"use client";

import React from "react";
import { Copy, Check, Zap, Undo2 } from "lucide-react";
import { useChat } from "@/context/ChatProvider";
import { useCashuStore } from "@/features/wallet";
import { getCurrentMintBalance as utilGetCurrentMintBalance } from "@/utils/walletUtils";
import { useWalletSend } from "@/features/wallet/hooks/useWalletSend";

interface SendSectionProps {
  mintBalances: Record<string, number>;
  isCurrentMintValid: boolean;
  hasMints: boolean;
}

const subTabBase =
  "flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer";
const getSubTabClass = (isActive: boolean, extra = "") =>
  `${subTabBase} ${
    isActive
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:text-foreground/80"
  } ${extra}`.trim();

const SendSection: React.FC<SendSectionProps> = ({
  mintBalances,
  isCurrentMintValid,
  hasMints,
}) => {
  const { currentMintUnit } = useChat();
  const cashuStore = useCashuStore();
  const send = useWalletSend();

  const availableBalance = utilGetCurrentMintBalance(cashuStore.activeMintUrl, mintBalances);
  const isValidSendAmount =
    send.sendAmount &&
    parseInt(send.sendAmount) > 0 &&
    parseInt(send.sendAmount) <= availableBalance;

  const msatNote =
    currentMintUnit === "msat" ? (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
        <div className="text-blue-600 dark:text-blue-200 text-sm text-center">
          Note: You are using msats (millisats). 1 sat = 1000 msats
        </div>
      </div>
    ) : null;

  return (
    <div className="p-4 space-y-3">
      {msatNote}
      <div className="flex bg-muted/50 rounded-lg p-1">
        <button
          onClick={() => send.setSendTab("token")}
          className={getSubTabClass(send.sendTab === "token")}
          type="button"
        >
          eCash Token
        </button>
        <button
          onClick={() => send.setSendTab("lightning")}
          className={getSubTabClass(
            send.sendTab === "lightning",
            "flex items-center justify-center gap-1"
          )}
          type="button"
        >
          <Zap className="h-3 w-3" />
          Lightning
        </button>
      </div>

      {send.sendTab === "token" && (
        <div className="space-y-3">
          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-xs">Available Balance</div>
            <div className="text-foreground text-lg font-bold">
              {availableBalance} {currentMintUnit === "msat" ? "msats" : "sats"}
            </div>
            {!isCurrentMintValid && (
              <div className="text-red-600 dark:text-red-400 text-xs mt-1">
                Invalid mint selected
              </div>
            )}
            {isCurrentMintValid && availableBalance === 0 && (
              <div className="text-yellow-600 dark:text-yellow-400 text-xs mt-1">
                No balance available in selected mint
              </div>
            )}
          </div>

          <div>
            <label className="block text-muted-foreground text-xs font-medium mb-2">
              Amount ({currentMintUnit}s)
            </label>
            <input
              type="text"
              value={send.sendAmount}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d+$/.test(v)) {
                  send.setSendAmount(v);
                  send.setError("");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send.generateSendToken();
                }
              }}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground text-lg font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="0"
              autoFocus
            />
            {send.sendAmount && parseInt(send.sendAmount) > availableBalance && (
              <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                Amount exceeds available balance
              </p>
            )}
          </div>

          <div className="grid grid-cols-4 gap-1">
            {[100, 500, 1000].map((amount) => (
              <button
                key={amount}
                onClick={() => send.setSendAmount(amount.toString())}
                disabled={amount > availableBalance}
                className="py-1.5 px-2 bg-muted/50 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed border border-border rounded-md text-muted-foreground text-xs transition-colors cursor-pointer"
              >
                {amount}
              </button>
            ))}
            <button
              onClick={() => send.setSendAmount(availableBalance.toString())}
              disabled={availableBalance === 0}
              className="py-1.5 px-2 bg-muted/50 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed border border-border rounded-md text-muted-foreground text-xs transition-colors cursor-pointer"
            >
              Max
            </button>
          </div>

          <button
            onClick={send.generateSendToken}
            disabled={!isValidSendAmount || send.isGeneratingSendToken || !hasMints || !isCurrentMintValid}
            className="w-full bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            {send.isGeneratingSendToken ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                Generating...
              </>
            ) : (
              "Generate Token"
            )}
          </button>

          {send.unclaimedTokens.length > 0 && (
            <div className="space-y-2">
              <div className="text-muted-foreground text-xs font-medium">
                {send.unclaimedTokens.length === 1
                  ? "Generated Token:"
                  : "Generated Tokens:"}
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-200 p-2 rounded-lg text-xs">
                Stored only in this browser profile and not synced to Nostr.
                Copy or reclaim before signing out, clearing site data, or
                switching devices.
              </div>
              {send.unclaimedTokens.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-muted/50 border border-border rounded-lg p-2"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-foreground font-medium">
                      {entry.amount} {entry.unit}s
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground break-all mb-2 max-h-20 overflow-y-auto">
                    {entry.token}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => send.copyToClipboard(entry.token, "Token", entry.id)}
                      className="flex-1 bg-muted hover:bg-muted/80 border border-border text-foreground py-1.5 px-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {send.copiedTokenId === entry.id ? (
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
                    <button
                      onClick={() => void send.reclaimUnclaimedToken(entry)}
                      disabled={send.reclaimingTokenId !== null}
                      title="Receive this token back into your own wallet"
                      className="flex-1 bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-1.5 px-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {send.reclaimingTokenId === entry.id ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-2 border-foreground/30 border-t-foreground" />
                          Reclaiming...
                        </>
                      ) : (
                        <>
                          <Undo2 className="h-3 w-3" />
                          Reclaim
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            "Dismiss this token? If nobody has redeemed it yet, the funds will be unrecoverable. Use Reclaim to take the funds back instead."
                          )
                        ) {
                          send.dismissUnclaimedToken(entry.id);
                        }
                      }}
                      title="Dismiss this token (after the recipient has redeemed it)"
                      className="px-2 py-1.5 bg-muted hover:bg-muted/80 border border-border text-muted-foreground hover:text-foreground rounded-md text-xs font-medium transition-colors cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              <div className="text-muted-foreground text-xs text-center">
                Tokens stay here until claimed — copy to share, or reclaim to
                take the funds back.
              </div>
            </div>
          )}
        </div>
      )}

      {send.sendTab === "lightning" && (
        <div className="space-y-3">
          <div>
            <label className="block text-muted-foreground text-xs font-medium mb-2">
              Lightning Invoice
            </label>
            <textarea
              value={send.nip60SendInvoice}
              onChange={(e) => send.handleNip60InvoiceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send.handlePayLightningInvoice();
                }
              }}
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground text-xs font-mono focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[80px] resize-y"
              placeholder="Paste lightning invoice here..."
              autoFocus
            />
          </div>

          {send.invoiceAmount && (
            <div className="bg-muted/50 border border-border rounded-lg p-3">
              <div className="text-muted-foreground text-xs mb-1">Invoice Amount</div>
              <div className="text-foreground text-lg font-bold">
                {send.invoiceAmount} {currentMintUnit}s
                {send.invoiceFeeReserve !== 0 && (
                  <span className="text-xs font-normal text-muted-foreground ml-2">
                    + max {send.invoiceFeeReserve} fee
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={send.handlePayLightningInvoice}
              disabled={
                !send.nip60SendInvoice.trim() ||
                send.isNip60Processing ||
                send.isNip60LoadingInvoice
              }
              className="flex-1 bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed border border-border text-foreground py-2 px-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {send.isNip60Processing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                  Paying...
                </>
              ) : send.isNip60LoadingInvoice ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-foreground/30 border-t-foreground" />
                  Loading...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Pay Invoice
                </>
              )}
            </button>

            {(send.nip60SendInvoice.trim() || send.nip60MeltQuoteId) && (
              <button
                onClick={send.handleNip60PaymentCancel}
                disabled={send.isNip60Processing}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-red-500/30 text-red-600 dark:text-red-200 rounded-lg font-medium transition-colors cursor-pointer"
                title="Cancel and clear invoice"
              >
                ✕
              </button>
            )}
          </div>

          <div className="text-muted-foreground text-xs text-center">
            Paste a lightning invoice to pay it instantly
          </div>
        </div>
      )}

      {(send.error || send.warningMessage || send.successMessage) && (
        <div>
          {send.error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-200 p-2 rounded-lg text-xs">
              {send.error}
            </div>
          )}
          {send.warningMessage && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-200 p-2 rounded-lg text-xs">
              {send.warningMessage}
            </div>
          )}
          {send.successMessage && (
            <div className="bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-200 p-2 rounded-lg text-xs">
              {send.successMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SendSection;
