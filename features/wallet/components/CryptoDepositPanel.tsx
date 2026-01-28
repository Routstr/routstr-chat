"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  AlertCircle,
  Copy,
  Loader2,
  ChevronDown,
  ExternalLink,
  CheckCircle,
  RefreshCw,
} from "lucide-react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { MintQuoteState } from "@cashu/cashu-ts";

import {
  useCashuWallet,
  useCashuStore,
  useTransactionHistoryStore,
  formatBalance,
} from "@/features/wallet";
import { useChat } from "@/context/ChatProvider";
import { createLightningInvoice, mintTokensFromPaidInvoice } from "@/lib/cashuLightning";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { createPendingTransaction } from "@/utils/transactionUtils";
import {
  SUPPORTED_TOKENS,
  createEvmToLightningSwap,
  getQuote,
  getSwapStatus,
  generateUserId,
  isSwapComplete,
  isSwapSucceeded,
  isSwapFailed,
  getStatusMessage,
  type EvmToBtcSwapResponse,
  type SwapStatus,
} from "@/lib/lendaswap";

type SupportedChain = "Polygon" | "Ethereum" | "Arbitrum";

type TokenOption = {
  chain: SupportedChain;
  token: {
    tokenId: string;
    symbol: string;
    name: string;
    decimals: number;
  };
};

interface CryptoDepositPanelProps {
  initialAmount?: number;
  className?: string;
}

const CHAIN_ICONS: Record<SupportedChain, string> = {
  Polygon: "🟣",
  Ethereum: "⟠",
  Arbitrum: "🔵",
};

const CHAIN_COLORS: Record<SupportedChain, string> = {
  Polygon: "from-purple-500/20 to-purple-600/10 border-purple-500/30",
  Ethereum: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
  Arbitrum: "from-sky-500/20 to-sky-600/10 border-sky-500/30",
};

const BLOCK_EXPLORERS: Record<SupportedChain, string> = {
  Polygon: "https://polygonscan.com/address/",
  Ethereum: "https://etherscan.io/address/",
  Arbitrum: "https://arbiscan.io/address/",
};

const CryptoDepositPanel: React.FC<CryptoDepositPanelProps> = ({
  initialAmount,
  className,
}) => {
  const options = useMemo<TokenOption[]>(() => {
    return (Object.keys(SUPPORTED_TOKENS) as SupportedChain[]).flatMap(
      (chain) =>
        SUPPORTED_TOKENS[chain].map((token) => ({
          chain,
          token,
        }))
    );
  }, []);

  const [selectedOption, setSelectedOption] = useState<TokenOption>(
    options[0]
  );
  const [amount, setAmount] = useState(initialAmount?.toString() || "");
  const [isOptionDropdownOpen, setIsOptionDropdownOpen] = useState(false);

  const [isCreatingSwap, setIsCreatingSwap] = useState(false);
  const [swap, setSwap] = useState<EvmToBtcSwapResponse | null>(null);
  const [swapStatus, setSwapStatus] = useState<SwapStatus | null>(null);
  const [lastStatusAt, setLastStatusAt] = useState<number | null>(null);
  const [quote, setQuote] = useState<{
    exchangeRate: string;
    stableAmount: number;
    protocolFee: number;
    networkFee: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingTxIdRef = useRef<string | null>(null);
  const quoteIdRef = useRef<string | null>(null);

  const { updateProofs } = useCashuWallet();
  const cashuStore = useCashuStore();
  const { activeAccount } = useChat();
  const transactionHistoryStore = useTransactionHistoryStore();
  const { addInvoice, updateInvoice } = useInvoiceSync();

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!options.length) return;
    setSelectedOption((current) => {
      const exists = options.find(
        (option) =>
          option.chain === current.chain &&
          option.token.tokenId === current.token.tokenId
      );
      return exists ?? options[0];
    });
  }, [options]);

  const fetchQuote = useCallback(async () => {
    const satsAmount = parseInt(amount);
    if (isNaN(satsAmount) || satsAmount <= 0) {
      setQuote(null);
      return;
    }

    try {
      console.info("[CryptoDeposit] Fetching quote", {
        satsAmount,
        from: selectedOption.token.tokenId,
        to: "btc_lightning",
      });
      const quoteResponse = await getQuote(
        selectedOption.token.tokenId,
        "btc_lightning",
        satsAmount
      );

      const exchangeRate = parseFloat(quoteResponse.exchange_rate);
      const stableAmount = (satsAmount / 100_000_000) * exchangeRate;

      console.info("[CryptoDeposit] Quote response", {
        exchangeRate: quoteResponse.exchange_rate,
        stableAmount,
        protocolFee: quoteResponse.protocol_fee,
        networkFee: quoteResponse.network_fee,
      });
      setQuote({
        exchangeRate: quoteResponse.exchange_rate,
        stableAmount,
        protocolFee: quoteResponse.protocol_fee,
        networkFee: quoteResponse.network_fee,
      });
    } catch (err) {
      console.info("[CryptoDeposit] Quote error", err);
      console.error("Failed to fetch quote:", err);
    }
  }, [amount, selectedOption.token.tokenId]);

  useEffect(() => {
    const debounce = setTimeout(fetchQuote, 500);
    return () => clearTimeout(debounce);
  }, [fetchQuote]);

  const pollSwapStatus = useCallback(
    async (swapId: string) => {
      try {
        console.info("[CryptoDeposit] Polling swap status", { swapId });
        const status = await getSwapStatus(swapId);
        console.info("[CryptoDeposit] Swap status", {
          swapId,
          status: status.status,
          sourceAmount: status.source_amount,
          targetAmount: status.target_amount,
        });
        setSwapStatus(status.status);
        setLastStatusAt(Date.now());

        if (isSwapComplete(status.status)) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          if (isSwapSucceeded(status.status)) {
            const mintUrl = cashuStore.activeMintUrl;
            const quoteId = quoteIdRef.current;
            const satsAmount = parseInt(amount);

            if (mintUrl && quoteId && satsAmount > 0) {
              try {
                console.info("[CryptoDeposit] Swap complete, minting", {
                  mintUrl,
                  quoteId,
                  satsAmount,
                });
                const proofs = await mintTokensFromPaidInvoice(
                  mintUrl,
                  quoteId,
                  satsAmount
                );

                if (proofs.length > 0) {
                  console.info("[CryptoDeposit] Minted proofs", {
                    count: proofs.length,
                    mintUrl,
                    quoteId,
                  });
                  await updateProofs({
                    mintUrl,
                    proofsToAdd: proofs,
                    proofsToRemove: [],
                  });

                  await updateInvoice(quoteId, {
                    state: MintQuoteState.PAID,
                    paidAt: Date.now(),
                  });

                  if (pendingTxIdRef.current) {
                    transactionHistoryStore.removePendingTransaction(
                      pendingTxIdRef.current
                    );
                  }

                  setSuccess(
                    `Successfully received ${formatBalance(satsAmount, "sats")}!`
                  );
                  toast.success(
                    `Received ${formatBalance(satsAmount, "sats")} via crypto swap!`
                  );
                }
              } catch (err) {
                console.info("[CryptoDeposit] Minting error", err);
                console.error("Failed to mint tokens:", err);
                setError(
                  "Swap completed but failed to mint tokens. Please check your wallet."
                );
              }
            }
          } else if (isSwapFailed(status.status)) {
            setError(`Swap failed: ${getStatusMessage(status.status)}`);
          }
        }
      } catch (err) {
        console.info("[CryptoDeposit] Polling error", err);
        console.error("Failed to poll swap status:", err);
      }
    },
    [amount, cashuStore.activeMintUrl, transactionHistoryStore, updateInvoice, updateProofs]
  );

  const handleCreateSwap = async (): Promise<void> => {
    const satsAmount = parseInt(amount);
    if (isNaN(satsAmount) || satsAmount <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!cashuStore.activeMintUrl) {
      setError("No active mint selected. Please configure your wallet first.");
      return;
    }

    setIsCreatingSwap(true);
    setError(null);

    try {
      console.info("[CryptoDeposit] Creating swap", {
        satsAmount,
        mintUrl: cashuStore.activeMintUrl,
        chain: selectedOption.chain,
        token: selectedOption.token.tokenId,
      });
      const invoiceData = await createLightningInvoice(
        cashuStore.activeMintUrl,
        satsAmount
      );

      console.info("[CryptoDeposit] Lightning invoice created", {
        quoteId: invoiceData.quoteId,
        expiresAt: invoiceData.expiresAt,
      });
      quoteIdRef.current = invoiceData.quoteId;

      await addInvoice({
        type: "mint",
        mintUrl: cashuStore.activeMintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
        amount: satsAmount,
        state: MintQuoteState.UNPAID,
        expiresAt: invoiceData.expiresAt,
      });

      const pendingTransaction = createPendingTransaction({
        direction: "in",
        amount: satsAmount,
        mintUrl: cashuStore.activeMintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
      });

      transactionHistoryStore.addPendingTransaction(pendingTransaction);
      pendingTxIdRef.current = pendingTransaction.id;

      const polygonRefundAddress = "0xd1e10eda29aa7d2802d09beca928b3e095e92be5";
      const userAddress =
        selectedOption.chain === "Polygon"
          ? polygonRefundAddress
          : "0x0000000000000000000000000000000000000000";
      const userId = generateUserId(activeAccount?.pubkey ?? null);

      console.info("[CryptoDeposit] Creating LendaSwap", {
        chain: selectedOption.chain,
        token: selectedOption.token.tokenId,
        userId,
      });
      const swapResponse = await createEvmToLightningSwap(selectedOption.chain, {
        bolt11_invoice: invoiceData.paymentRequest,
        source_token: selectedOption.token.tokenId,
        user_address: userAddress,
        user_id: userId,
      });

      console.info("[CryptoDeposit] Swap created", {
        swapId: swapResponse.id,
        status: swapResponse.status,
        address: swapResponse.htlc_address_evm,
      });
      setSwap(swapResponse);
      setSwapStatus(swapResponse.status);
      setLastStatusAt(Date.now());

      void pollSwapStatus(swapResponse.id);
      pollIntervalRef.current = setInterval(() => {
        pollSwapStatus(swapResponse.id);
      }, 5000);
    } catch (err) {
      console.info("[CryptoDeposit] Swap creation error", err);
      console.error("Failed to create swap:", err);
      setError(
        err instanceof Error ? err.message : "Failed to create swap. Please try again."
      );
    } finally {
      setIsCreatingSwap(false);
    }
  };

  const copyAddress = (): void => {
    if (swap?.htlc_address_evm) {
      navigator.clipboard.writeText(swap.htlc_address_evm);
      toast.success("Address copied to clipboard");
    }
  };

  const handleReset = (): void => {
    setSwap(null);
    setSwapStatus(null);
    setLastStatusAt(null);
    setQuote(null);
    setError(null);
    setSuccess(null);
    setAmount("");
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const statusLabel = swapStatus ? getStatusMessage(swapStatus) : "Pending";
  const lastCheckedLabel = lastStatusAt
    ? new Date(lastStatusAt).toLocaleTimeString()
    : "Never";

  return (
    <div className={className}>
      <div className="space-y-5">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-md text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-3 rounded-md text-sm flex items-start gap-2">
            <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {!swap ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Network + Token
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsOptionDropdownOpen(!isOptionDropdownOpen)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-md border bg-linear-to-r ${
                    CHAIN_COLORS[selectedOption.chain]
                  } transition-all hover:opacity-90`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {CHAIN_ICONS[selectedOption.chain]}
                    </span>
                    <span className="font-medium text-foreground">
                      {selectedOption.chain}
                    </span>
                    <span className="text-muted-foreground">/</span>
                    <span className="font-medium text-foreground">
                      {selectedOption.token.symbol}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {selectedOption.token.name}
                    </span>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                      isOptionDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isOptionDropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
                    {options.map((option) => (
                      <button
                        key={`${option.chain}-${option.token.tokenId}`}
                        type="button"
                        onClick={() => {
                          setSelectedOption(option);
                          setIsOptionDropdownOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors ${
                          option.chain === selectedOption.chain &&
                          option.token.tokenId === selectedOption.token.tokenId
                            ? "bg-muted/50"
                            : ""
                        }`}
                      >
                        <span className="text-lg">
                          {CHAIN_ICONS[option.chain]}
                        </span>
                        <span className="text-foreground">{option.chain}</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="font-medium text-foreground">
                          {option.token.symbol}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {option.token.name}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Amount to receive (sats)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g., 10000"
                className="w-full px-4 py-3 rounded-md border border-border bg-muted/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {quote && (
              <div className="bg-muted/30 border border-border rounded-md p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">You send</span>
                  <span className="text-foreground font-medium">
                    ~{quote.stableAmount.toFixed(2)} {selectedOption.token.symbol}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Exchange rate</span>
                  <span className="text-muted-foreground">
                    1 BTC = ${parseFloat(quote.exchangeRate).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Network fee</span>
                  <span className="text-muted-foreground">
                    {quote.networkFee} sats
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleCreateSwap}
              disabled={isCreatingSwap || !amount || !cashuStore.activeMintUrl}
              className="w-full py-3 px-4 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isCreatingSwap ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating swap...
                </>
              ) : (
                "Create Deposit Address"
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isSwapSucceeded(swapStatus!)
                      ? "bg-green-500"
                      : isSwapFailed(swapStatus!)
                        ? "bg-red-500"
                        : "bg-yellow-500 animate-pulse"
                  }`}
                />
                <span className="text-sm text-muted-foreground">
                  {statusLabel}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Last check: {lastCheckedLabel}</span>
                {!isSwapComplete(swapStatus!) && (
                  <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin" />
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void pollSwapStatus(swap.id)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Check deposit now
              </button>
            </div>

            <div className="bg-white p-4 rounded-lg flex items-center justify-center">
              <QRCode value={swap.htlc_address_evm} size={180} />
            </div>

            <div className="space-y-3">
              <div className="bg-muted/30 border border-border rounded-md p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  Send exactly
                </div>
                <div className="text-lg font-mono font-semibold text-foreground">
                  {swap.source_amount.toFixed(
                    selectedOption.token.decimals > 2 ? 6 : 2
                  )}{" "}
                  {selectedOption.token.symbol}
                </div>
              </div>

              <div className="bg-muted/30 border border-border rounded-md p-3">
                <div className="text-xs text-muted-foreground mb-1">
                  To address on {selectedOption.chain}
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-foreground break-all">
                    {swap.htlc_address_evm}
                  </code>
                  <button
                    type="button"
                    onClick={copyAddress}
                    className="p-1.5 hover:bg-muted rounded transition-colors"
                  >
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              </div>

              <a
                href={`${BLOCK_EXPLORERS[selectedOption.chain]}${swap.htlc_address_evm}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-sm text-primary hover:underline"
              >
                View on block explorer
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3">
              <div className="text-xs text-green-400 mb-1">You will receive</div>
              <div className="text-lg font-semibold text-green-400">
                {formatBalance(swap.target_amount, "sats")}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="flex-1 py-2.5 px-4 rounded-md border border-border text-foreground font-medium hover:bg-muted transition-colors"
              >
                {isSwapComplete(swapStatus!) ? "New Deposit" : "Cancel"}
              </button>
            </div>

            {!isSwapComplete(swapStatus!) && (
              <p className="text-xs text-muted-foreground text-center">
                The swap will update once your USDC/USDT deposit is detected and
                confirmed. This typically takes 1-2 minutes.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CryptoDepositPanel;
