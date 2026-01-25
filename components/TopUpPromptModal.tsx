"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ClipboardPaste,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  QrCode,
  Shield,
  UserPlus,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "react-qr-code";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  useCashuWallet,
  useCashuStore,
  useTransactionHistoryStore,
  formatBalance,
  useCashuToken,
} from "@/features/wallet";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { createPendingTransaction } from "@/utils/transactionUtils";
import {
  createLightningInvoice,
  mintTokensFromPaidInvoice,
} from "@/lib/cashuLightning";
import { MintQuoteState, getDecodedToken } from "@cashu/cashu-ts";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAccountManager, AccountMetadata } from "@/components/ClientProviders";
import {
  ExtensionAccount,
  NostrConnectAccount,
  PrivateKeyAccount,
} from "applesauce-accounts/accounts";
import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import { markEphemeralNsecCreated } from "@/utils/storageUtils";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { toast } from "sonner";
import { ModalShell } from "@/components/ui/ModalShell";
import CloseButton from "@/components/ui/CloseButton";
import {
  requestBitcoinConnectProvider,
  useBitcoinConnectStatus,
} from "@/hooks/useBitcoinConnect";

const pool = new RelayPool();

if (typeof window !== "undefined") {
  NostrConnectSigner.subscriptionMethod = pool.subscription.bind(pool);
  NostrConnectSigner.publishMethod = pool.publish.bind(pool);
}

interface TopUpPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  cashuToken?: string;
  defaultPage?: "topup" | "login";
  onShowQRCode?: (data: {
    invoice: string;
    amount: string;
    unit: string;
  }) => void;
}

const TopUpPromptModal: React.FC<TopUpPromptModalProps> = ({
  isOpen,
  onClose,
  cashuToken: cashuTokenParam,
  defaultPage = "topup",
  onShowQRCode,
}) => {
  const [customAmount, setCustomAmount] = useState("");
  const [invoice, setInvoice] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingTransactionId, setPendingTransactionId] = useState<
    string | null
  >(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);

  const { updateProofs } = useCashuWallet();
  const cashuStore = useCashuStore();
  const { addInvoice, updateInvoice } = useInvoiceSync();
  const transactionHistoryStore = useTransactionHistoryStore();
  const { receiveToken } = useCashuToken();
  const isMobile = useMediaQuery("(max-width: 640px)");
  const {
    status: bcStatus,
    balance: bcBalance,
    connect: connectWallet,
  } = useBitcoinConnectStatus();
  const [cashuToken, setCashuToken] = useState("");
  const [isReceivingToken, setIsReceivingToken] = useState(false);
  const [activeTab, setActiveTab] = useState<"lightning" | "token" | "wallet">(
    "lightning"
  );
  const [nwcCustomAmount, setNwcCustomAmount] = useState("");
  const [isPayingWithNWC, setIsPayingWithNWC] = useState(false);
  const [activePage, setActivePage] = useState<"topup" | "login">(
    defaultPage
  );
  const prevOpenRef = useRef(false);
  const prevDefaultPageRef = useRef(defaultPage);
  const [loginNsec, setLoginNsec] = useState("");
  const [isConnectingExtension, setIsConnectingExtension] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [hasExtension, setHasExtension] = useState(false);
  const [activeLoginMethod, setActiveLoginMethod] = useState<
    "nsec" | "bunker" | "qr"
  >("nsec");
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [isConnectingBunker, setIsConnectingBunker] = useState(false);
  const [nostrConnectUri, setNostrConnectUri] = useState<string | null>(null);
  const [isConnectingQR, setIsConnectingQR] = useState(false);
  const [signupStep, setSignupStep] = useState<"initial" | "save-keys">(
    "initial"
  );
  const [generatedAccount, setGeneratedAccount] =
    useState<PrivateKeyAccount<AccountMetadata> | null>(null);
  const [nsecCopied, setNsecCopied] = useState(false);
  const [showNsec, setShowNsec] = useState(false);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);

  const { manager, manualSave } = useAccountManager();

  useEffect(() => {
    setHasExtension(
      typeof window !== "undefined" && Boolean((window as any).nostr)
    );
  }, []);

  // Prevent hydration mismatch by waiting for client-side hydration
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      prevOpenRef.current = false;
      prevDefaultPageRef.current = defaultPage;
      return;
    }

    if (!prevOpenRef.current || defaultPage !== prevDefaultPageRef.current) {
      setActivePage(defaultPage);
    }

    prevOpenRef.current = true;
    prevDefaultPageRef.current = defaultPage;
  }, [isOpen, defaultPage]);

  // Auto-receive cashu token from URL parameter
  useEffect(() => {
    if (!isOpen || !isHydrated || !cashuTokenParam) return;

    // Switch to top up flow and token tab
    setActivePage("topup");
    setCashuToken(cashuTokenParam);
    setActiveTab("token");

    // Automatically receive the token
    const autoReceive = async () => {
      if (!cashuTokenParam.trim()) return;

      createNsecForLogin();

      try {
        setIsReceivingToken(true);

        // Decode token to get original amount and unit for display
        const decodedToken = getDecodedToken(cashuTokenParam.trim());
        if (!decodedToken) {
          throw new Error("Invalid token format");
        }

        const tokenUnit = decodedToken.unit || "sat";
        // Calculate total from original token proofs
        const originalTotalAmount = decodedToken.proofs.reduce(
          (sum: number, p: { amount: number }) => sum + p.amount,
          0
        );

        // Receive the token
        await receiveToken(cashuTokenParam.trim());

        // Convert msat to sat for display consistency
        const displayAmount =
          tokenUnit === "msat"
            ? Math.floor(originalTotalAmount / 1000)
            : originalTotalAmount;

        toast.success(
          `Received ${formatBalance(displayAmount, "sats")}!`
        );
        setCashuToken("");
        setTimeout(() => {
          onClose();
        }, 2000);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to receive token";
        toast.error(message);
      } finally {
        setIsReceivingToken(false);
      }
    };

    void autoReceive();
  }, [isOpen, isHydrated, cashuTokenParam]);

  const quickAmounts = [500, 1000, 5000];
  const isTopUpPage = activePage === "topup";
  const modalWidthClass = "max-w-md";
  const dialogHeightClass = isMobile ? "h-[85vh]" : "h-[640px]";
  const headerTitle = isTopUpPage ? "Top up" : "Sign in";
  const headerSubtitle = isTopUpPage
    ? "Add sats to your Cashu wallet"
    : "Create or connect your Nostr identity";
  const sanitizePositiveAmount = (value: string) => {
    const digitsOnly = value.replace(/[^\d]/g, "");
    const trimmed = digitsOnly.replace(/^0+(?=\d)/, "");
    if (trimmed === "0") return "";
    return trimmed;
  };

  const createNsecForLogin = () => {
    // Only create if no accounts exist
    const accounts = manager.accounts$.value;
    if (accounts.length > 0) return;
    
    const account = PrivateKeyAccount.generateNew<AccountMetadata>();
    manager.addAccount(account);
    manager.setActive(account);
    manualSave.next();
    markEphemeralNsecCreated();
  };

  const generateNewIdentity = useCallback(() => {
    const account = PrivateKeyAccount.generateNew<AccountMetadata>();
    const count = manager.accounts$.value.length + 1;
    account.metadata = { name: `Account ${count}` };
    setGeneratedAccount(account);
    setNsecCopied(false);
    setShowSaveConfirmation(false);
    setShowNsec(false);
    setSignupStep("save-keys");
  }, [manager]);

  const getGeneratedNsec = useCallback(() => {
    if (!generatedAccount) return null;
    try {
      const secretKey =
        (generatedAccount as any).key ??
        (generatedAccount as any).signer?.key;
      if (secretKey) return nip19.nsecEncode(secretKey);
    } catch (err) {
      console.error("Error encoding nsec:", err);
    }
    return null;
  }, [generatedAccount]);

  const generatedNsec = getGeneratedNsec();

  const copyGeneratedNsec = useCallback(async () => {
    if (!generatedNsec) return;
    try {
      await navigator.clipboard.writeText(generatedNsec);
      setNsecCopied(true);
      setTimeout(() => setNsecCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy nsec:", err);
    }
  }, [generatedNsec]);

  const completeSignup = useCallback(() => {
    if (!generatedAccount) return;
    manager.addAccount(generatedAccount as any);
    manager.setActive(generatedAccount as any);
    manualSave.next();
    setSignupStep("initial");
    setGeneratedAccount(null);
    onClose();
  }, [generatedAccount, manager, manualSave, onClose]);

  const handleExtensionLogin = useCallback(async () => {
    if (!hasExtension) return;
    try {
      setIsConnectingExtension(true);
      const account = await ExtensionAccount.fromExtension();
      manager.addAccount(account as any);
      manager.setActive(account as any);
      manualSave.next();
      onClose();
    } catch (err) {
      console.error("Extension login error:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to connect to extension"
      );
    } finally {
      setIsConnectingExtension(false);
    }
  }, [hasExtension, manager, manualSave, onClose]);

  const handleKeyLogin = useCallback(() => {
    if (!loginNsec.trim()) return;
    setIsLoggingIn(true);

    try {
      const account = PrivateKeyAccount.fromKey<AccountMetadata>(
        loginNsec.trim()
      );
      const count = manager.accounts$.value.length + 1;
      account.metadata = { name: `Account ${count}` };
      manager.addAccount(account as any);
      manager.setActive(account as any);
      manualSave.next();
      setLoginNsec("");
      onClose();
    } catch (err) {
      console.error("Private key login error:", err);
      toast.error(err instanceof Error ? err.message : "Invalid private key");
    } finally {
      setIsLoggingIn(false);
    }
  }, [loginNsec, manager, manualSave, onClose]);

  const handleBunkerConnect = useCallback(async () => {
    if (!bunkerUrl) return;

    try {
      setIsConnectingBunker(true);

      const signer = await NostrConnectSigner.fromBunkerURI(bunkerUrl);
      const pubkey = await signer.getPublicKey();
      const account = new NostrConnectAccount<AccountMetadata>(pubkey, signer);
      const count = manager.accounts$.value.length + 1;
      account.metadata = { name: `Bunker ${count}` };
      manager.addAccount(account as any);
      manager.setActive(account as any);
      manualSave.next();
      setBunkerUrl("");
      setActiveLoginMethod("nsec");
      onClose();
    } catch (err) {
      console.error("Bunker connection error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setIsConnectingBunker(false);
    }
  }, [bunkerUrl, manager, manualSave, onClose]);

  const handleQrCodeLogin = useCallback(async () => {
    try {
      setIsConnectingQR(true);

      const signer = new NostrConnectSigner({
        relays: ["wss://relay.nsec.app"],
      });

      const uri = signer.getNostrConnectURI({
        name: "Routstr Chat",
      });

      setNostrConnectUri(uri);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        await signer.waitForSigner(controller.signal);
        clearTimeout(timeoutId);

        const pubkey = await signer.getPublicKey();
        const account = new NostrConnectAccount<AccountMetadata>(pubkey, signer);
        const count = manager.accounts$.value.length + 1;
        account.metadata = { name: `Bunker ${count}` };
        manager.addAccount(account as any);
        manager.setActive(account as any);
        manualSave.next();
        setNostrConnectUri(null);
        setActiveLoginMethod("nsec");
        onClose();
      } catch (err) {
        console.error("Wait for signer error:", err);
        if (err instanceof Error && err.message === "Aborted") {
          toast.error("Connection timeout. Please try again.");
        } else {
          toast.error(err instanceof Error ? err.message : "Failed to connect");
        }
        setNostrConnectUri(null);
      }
    } catch (err) {
      console.error("QR code login error:", err);
      toast.error(
        err instanceof Error ? err.message : "QR code login failed"
      );
      setNostrConnectUri(null);
    } finally {
      setIsConnectingQR(false);
    }
  }, [manager, manualSave, onClose]);

  const cancelQR = useCallback(() => {
    setNostrConnectUri(null);
    setActiveLoginMethod("nsec");
    setIsConnectingQR(false);
  }, []);

  const copyInvoiceToClipboard = async () => {
    if (!invoice) return;
    try {
      await navigator.clipboard.writeText(invoice);
      toast.success("Invoice copied to clipboard");
    } catch (e) {
      toast.error("Failed to copy invoice");
    }
  };

  const handlePasteToken = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCashuToken(text);
    } catch (e) {
      toast.error("Failed to read from clipboard");
    }
  };

  const handlePasteLoginNsec = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setLoginNsec(text.trim());
    } catch (e) {
      toast.error("Failed to read from clipboard");
    }
  };

  const handlePasteBunkerUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setBunkerUrl(text.trim());
    } catch (e) {
      toast.error("Failed to read from clipboard");
    }
  };

  const handleReceiveToken = async () => {
    if (!cashuToken.trim()) {
      toast.error("Please paste a cashu token");
      return;
    }

    createNsecForLogin();

    try {
      setIsReceivingToken(true);

      // Decode token to get original amount and unit for display
      const decodedToken = getDecodedToken(cashuToken.trim());
      if (!decodedToken) {
        throw new Error("Invalid token format");
      }

      const tokenUnit = decodedToken.unit || "sat";
      // Calculate total from original token proofs
      const originalTotalAmount = decodedToken.proofs.reduce(
        (sum: number, p: { amount: number }) => sum + p.amount,
        0
      );

      // Receive the token
      await receiveToken(cashuToken.trim());

      // Convert msat to sat for display consistency
      const displayAmount =
        tokenUnit === "msat"
          ? Math.floor(originalTotalAmount / 1000)
          : originalTotalAmount;

      toast.success(
        `Received ${formatBalance(displayAmount, "sats")}!`
      );
      setCashuToken("");
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to receive token";
      toast.error(message);
    } finally {
      setIsReceivingToken(false);
    }
  };

  const handleCreateInvoice = async (amount?: number) => {
    const fallbackMintUrl =
      cashuStore.mints[0]?.url || DEFAULT_MINT_URL;
    const mintUrl = cashuStore.activeMintUrl || fallbackMintUrl;

    createNsecForLogin();

    const amt = amount !== undefined ? amount : parseInt(customAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    try {
      setIsProcessing(true);

      if (!cashuStore.activeMintUrl) {
        if (!cashuStore.mints.find((mint) => mint.url === mintUrl)) {
          cashuStore.addMint(mintUrl);
        }
        cashuStore.setActiveMintUrl(mintUrl);
      }

      const invoiceData = await createLightningInvoice(
        mintUrl,
        amt
      );
      setInvoice(invoiceData.paymentRequest);
      setQuoteId(invoiceData.quoteId);
      setPendingAmount(amt);

      await addInvoice({
        type: "mint",
        mintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
        amount: amt,
        state: MintQuoteState.UNPAID,
        expiresAt: invoiceData.expiresAt,
      });

      const pendingTx = createPendingTransaction({
        direction: "in",
        amount: amt,
        mintUrl,
        quoteId: invoiceData.quoteId,
        paymentRequest: invoiceData.paymentRequest,
      });
      transactionHistoryStore.addPendingTransaction(pendingTx);
      setPendingTransactionId(pendingTx.id);

      void checkPaymentStatus(mintUrl, invoiceData.quoteId, amt, pendingTx.id);
    } catch (e) {
      console.error("Error creating invoice:", e);
      toast.error("Failed to create invoice");
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaid = async (_response: any) => {
    if (!cashuStore.activeMintUrl || !quoteId || !pendingAmount) return;
    try {
      const proofs = await mintTokensFromPaidInvoice(
        cashuStore.activeMintUrl,
        quoteId,
        pendingAmount
      );
      if (proofs.length > 0) {
        await updateProofs({
          mintUrl: cashuStore.activeMintUrl,
          proofsToAdd: proofs,
          proofsToRemove: [],
        });
        await updateInvoice(quoteId, {
          state: MintQuoteState.PAID,
          paidAt: Date.now(),
        });
        if (pendingTransactionId)
          transactionHistoryStore.removePendingTransaction(
            pendingTransactionId
          );
        setPendingTransactionId(null);
        toast.success(
          `Received ${formatBalance(pendingAmount, "sats")}!`
        );
        setInvoice("");
        setQuoteId("");
        setPendingAmount(null);
      }
    } catch (_e) {
      // Fallback to existing polling which is already in progress
    }
  };

  const resetInvoice = useCallback(() => {
    setInvoice("");
    setQuoteId("");
    setPendingAmount(null);
    setCustomAmount("");
  }, []);

  const checkPaymentStatus = async (
    mintUrl: string,
    qid: string,
    amt: number,
    pendingId: string
  ) => {
    try {
      const proofs = await mintTokensFromPaidInvoice(mintUrl, qid, amt);
      if (proofs.length > 0) {
        await updateProofs({
          mintUrl,
          proofsToAdd: proofs,
          proofsToRemove: [],
        });
        await updateInvoice(qid, {
          state: MintQuoteState.PAID,
          paidAt: Date.now(),
        });
        transactionHistoryStore.removePendingTransaction(pendingId);
        setPendingTransactionId(null);
        toast.success(`Received ${formatBalance(amt, "sats")}!`);
        return;
      }
      setTimeout(() => {
        if (quoteId === qid) {
          void checkPaymentStatus(mintUrl, qid, amt, pendingId);
        }
      }, 5000);
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("not been paid"))) {
        console.error("Error checking payment:", e);
        toast.error("Failed to check payment");
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
    if (bcStatus !== "connected") {
      toast.error("Please connect your wallet first");
      return;
    }

    createNsecForLogin();

    const fallbackMintUrl =
      cashuStore.mints[0]?.url || DEFAULT_MINT_URL;
    const mintUrl = cashuStore.activeMintUrl || fallbackMintUrl;

    const amt = amount !== undefined ? amount : parseInt(nwcCustomAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    try {
      setIsPayingWithNWC(true);

      if (!cashuStore.activeMintUrl) {
        if (!cashuStore.mints.find((mint) => mint.url === mintUrl)) {
          cashuStore.addMint(mintUrl);
        }
        cashuStore.setActiveMintUrl(mintUrl);
      }

      // Create invoice
      const invoiceData = await createLightningInvoice(
        mintUrl,
        amt
      );
      const paymentRequest = invoiceData.paymentRequest;
      const qid = invoiceData.quoteId;

      await addInvoice({
        type: "mint",
        mintUrl,
        quoteId: qid,
        paymentRequest,
        amount: amt,
        state: MintQuoteState.UNPAID,
        expiresAt: invoiceData.expiresAt,
      });

      const pendingTx = createPendingTransaction({
        direction: "in",
        amount: amt,
        mintUrl,
        quoteId: qid,
        paymentRequest,
      });
      transactionHistoryStore.addPendingTransaction(pendingTx);

      // Pay with connected wallet
      try {
        const provider = await requestBitcoinConnectProvider();
        const res = await provider.sendPayment(paymentRequest);

        // Check payment status and update proofs
        if (res && (res as any).preimage) {
          const proofs = await mintTokensFromPaidInvoice(
            mintUrl,
            qid,
            amt
          );
          if (proofs.length > 0) {
            await updateProofs({
              mintUrl,
              proofsToAdd: proofs,
              proofsToRemove: [],
            });
            await updateInvoice(qid, {
              state: MintQuoteState.PAID,
              paidAt: Date.now(),
            });
            transactionHistoryStore.removePendingTransaction(pendingTx.id);
            toast.success(`Received ${formatBalance(amt, "sats")}!`);
            setNwcCustomAmount("");
            setTimeout(() => {
              onClose();
            }, 2000);
          } else {
            // Start polling if proofs not immediately available
            void checkPaymentStatus(mintUrl, qid, amt, pendingTx.id);
          }
        } else {
          // Start polling
          void checkPaymentStatus(mintUrl, qid, amt, pendingTx.id);
        }
      } catch (paymentError) {
        console.error("Error paying with NWC:", paymentError);
        toast.error("Payment failed. Please try again.");
        void checkPaymentStatus(mintUrl, qid, amt, pendingTx.id);
      }
    } catch (e) {
      console.error("Error creating invoice:", e);
      toast.error("Failed to create invoice");
    } finally {
      setIsPayingWithNWC(false);
    }
  };

  const modalHeader = (
    <div className="flex items-center gap-2 pb-2">
      {isTopUpPage ? (
        <div className="w-8" />
      ) : (
        <button
          onClick={() => setActivePage("topup")}
          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label="Back to top up"
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      <div className="flex-1 text-center">
        <h2 className="text-lg font-semibold text-foreground">{headerTitle}</h2>
        <p className="text-xs text-muted-foreground">{headerSubtitle}</p>
      </div>
      <CloseButton
        onClick={onClose}
        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        iconClassName="h-4 w-4"
        ariaLabel="Close"
      />
    </div>
  );

  const topUpTabs = [
    { key: "lightning" as const, label: "Lightning" },
    { key: "token" as const, label: "Token" },
    { key: "wallet" as const, label: "NWC" },
  ];

  const topUpTabButtonBase =
    "flex-1 px-3 py-2 text-sm font-medium transition-colors";

  const topUpContent = (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {topUpTabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`${topUpTabButtonBase} ${
                isActive
                  ? "text-foreground border-b-2 border-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content Container */}
      <div>
        {/* Lightning Tab */}
        {activeTab === "lightning" && (
          <div className="space-y-3">
            {/* QR / placeholder */}
            <div
              className={`border border-border rounded-lg p-3 flex flex-col items-center justify-center min-h-[140px] ${
                invoice ? "bg-transparent" : "bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-center rounded-md p-2">
                {invoice ? (
                  <div className="bg-background p-2 rounded-md">
                    <QRCode
                      value={invoice}
                      size={140}
                      bgColor="transparent"
                      fgColor="currentColor"
                    />
                  </div>
                ) : (
                  <QrCode className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              {invoice && pendingAmount !== null && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {pendingAmount} sats
                </div>
              )}
            </div>

            {invoice && (
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 bg-muted/50 border border-border rounded-md text-xs font-mono text-foreground/80 truncate">
                  {invoice}
                </div>
                <button
                  onClick={copyInvoiceToClipboard}
                  className="shrink-0 px-3 py-2 rounded-md border border-border bg-muted/60 text-xs font-medium text-foreground hover:bg-muted/80 transition-all"
                  type="button"
                >
                  Copy
                </button>
              </div>
            )}

            {invoice ? (
              <div className="flex justify-center">
                <button
                  onClick={resetInvoice}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  type="button"
                >
                  New amount
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  {quickAmounts.map((a) => (
                    <button
                      key={a}
                      onClick={() => {
                        void handleCreateInvoice(a);
                      }}
                      className="flex-1 bg-muted/50 hover:bg-muted border border-border hover:border-border text-foreground px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer"
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
                    min={1}
                    step={1}
                    placeholder="Custom amount (sats)"
                    value={customAmount}
                    onChange={(e) =>
                      setCustomAmount(sanitizePositiveAmount(e.target.value))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleCreateInvoice();
                      }
                    }}
                    className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring transition-all"
                  />
                  <button
                    onClick={() => {
                      void handleCreateInvoice();
                    }}
                    className="bg-muted/50 hover:bg-muted border border-border text-foreground px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    type="button"
                    aria-busy={isProcessing}
                    disabled={isProcessing || !customAmount.trim()}
                  >
                    <span className="flex items-center gap-2">
                      {isProcessing && (
                        <svg
                          className="animate-spin h-4 w-4"
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
                      )}
                      Get Invoice
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Token Tab */}
        {activeTab === "token" && (
          <div className="flex flex-col justify-center h-full">
            <div className="space-y-4">
              <div>
                <div className="relative">
                  <textarea
                    value={cashuToken}
                    onChange={(e) => setCashuToken(e.target.value)}
                    placeholder="Paste Cashu token..."
                    className="w-full bg-muted/50 border border-border rounded-lg px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring resize-none transition-all"
                    rows={10}
                  />
                  <button
                    onClick={handlePasteToken}
                    className="absolute top-3 right-3 bg-muted/50 hover:bg-muted border border-border text-foreground p-2 rounded-md transition-all cursor-pointer flex items-center justify-center"
                    type="button"
                    title="Paste from clipboard"
                  >
                    <ClipboardPaste className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <button
                onClick={() => {
                  void handleReceiveToken();
                }}
                disabled={isReceivingToken || !cashuToken.trim()}
                className="w-full bg-muted/50 hover:bg-muted border border-border text-foreground px-4 py-3 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
              >
                {isReceivingToken ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M21 12a9 9 0 1 1-6.219-8.56"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        fill="none"
                      />
                    </svg>
                    Receiving...
                  </span>
                ) : (
                  "Receive Token"
                )}
              </button>
            </div>
          </div>
        )}

        {/* Wallet Tab */}
        {activeTab === "wallet" && (
          <div className="space-y-4">
            <div className="bg-muted/50 border border-border rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-medium text-muted-foreground block">
                    Wallet (NWC)
                  </span>
                  {bcStatus === "connected" && bcBalance !== null && (
                    <span className="text-xs text-muted-foreground mt-1 block">
                      {bcBalance.toLocaleString()} sats
                    </span>
                  )}
                </div>
                {bcStatus === "connected" ? (
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 bg-green-600 dark:bg-green-400 rounded-full"></div>
                    <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                      Connected
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        createNsecForLogin();
                        await connectWallet();
                      } catch {}
                    }}
                    className="px-4 py-2 text-sm bg-muted/50 hover:bg-muted border border-border rounded-lg text-foreground transition-all"
                    type="button"
                  >
                    {bcStatus === "connecting" ? (
                      <span className="flex items-center gap-2">
                        <svg
                          className="animate-spin h-4 w-4"
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
                        Connecting…
                      </span>
                    ) : (
                      "Connect Wallet"
                    )}
                  </button>
                )}
              </div>
            </div>

            {bcStatus === "connected" && (
              <>
                <div className="flex gap-2">
                  {quickAmounts.map((a) => (
                    <button
                      key={a}
                      onClick={() => {
                        void handlePayWithNWC(a);
                      }}
                      disabled={isPayingWithNWC}
                      className="flex-1 bg-muted/50 hover:bg-muted border border-border text-foreground px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
                    min={1}
                    step={1}
                    placeholder="Custom amount (sats)"
                    value={nwcCustomAmount}
                    onChange={(e) =>
                      setNwcCustomAmount(
                        sanitizePositiveAmount(e.target.value)
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handlePayWithNWC();
                      }
                    }}
                    disabled={isPayingWithNWC}
                    className="flex-1 bg-muted/50 border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={() => {
                      void handlePayWithNWC();
                    }}
                    disabled={isPayingWithNWC || !nwcCustomAmount.trim()}
                    className="bg-muted/50 hover:bg-muted border border-border text-foreground px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    type="button"
                  >
                    {isPayingWithNWC ? (
                      <span className="flex items-center gap-2">
                        <svg
                          className="animate-spin h-4 w-4"
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
                      </span>
                    ) : (
                      "Pay"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );

  const methodCardClass =
    "rounded-lg border border-border bg-muted/40 p-3 sm:p-4 space-y-2";

  const loginContent = (
    <div className="space-y-4">
      {signupStep === "save-keys" && generatedNsec ? (
        <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">New identity</p>
            <button
              onClick={() => setShowNsec(!showNsec)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              type="button"
            >
              {showNsec ? (
                <span className="inline-flex items-center gap-1">
                  <EyeOff className="h-3 w-3" />
                  Hide
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  Show
                </span>
              )}
            </button>
          </div>

          <div className="px-2 py-2 bg-muted/60 border border-border rounded-lg text-xs text-foreground/80 break-all font-mono flex items-center gap-2">
            <span className="flex-1">
              {showNsec
                ? generatedNsec
                : generatedNsec.substring(0, 8) +
                  "•".repeat(20) +
                  generatedNsec.substring(generatedNsec.length - 8)}
            </span>
            <button
              onClick={copyGeneratedNsec}
              className="shrink-0 inline-flex items-center justify-center px-2 py-1 rounded-md border border-border bg-muted/70 text-[10px] font-medium text-foreground hover:bg-muted/80 transition-colors"
              type="button"
            >
              {nsecCopied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={showSaveConfirmation}
                onCheckedChange={(checked) =>
                  setShowSaveConfirmation(checked === true)
                }
              />
              <button
                type="button"
                onClick={() =>
                  setShowSaveConfirmation((current) => !current)
                }
                className="text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                I’ve saved my key
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setSignupStep("initial");
                setGeneratedAccount(null);
              }}
              className="flex-1 py-2 rounded-md border border-border bg-muted/60 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={completeSignup}
              disabled={!showSaveConfirmation}
              className="flex-1 py-2 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 p-4 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">
            Create new identity
          </p>
          <button
            onClick={generateNewIdentity}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/60 text-xs font-semibold text-foreground hover:bg-muted/80 transition-colors"
            type="button"
          >
            <UserPlus className="h-4 w-4" />
            Create
          </button>
        </div>
      )}

      {signupStep === "initial" && (
        <>
          <div className="space-y-2">
            <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveLoginMethod("nsec")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap ${
                  activeLoginMethod === "nsec"
                    ? "bg-foreground/10 text-foreground border-foreground/30"
                    : "bg-muted/50 border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                }`}
                type="button"
              >
                <KeyRound className="w-3 h-3" />
                Private key
              </button>
              {hasExtension && (
                <button
                  onClick={handleExtensionLogin}
                  disabled={isConnectingExtension}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-border bg-muted/60 text-foreground text-[11px] font-medium hover:bg-muted/80 transition-colors whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                >
                  {isConnectingExtension ? (
                    <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Shield className="w-3 h-3" />
                      Extension
                    </>
                  )}
                </button>
              )}
              <button
                onClick={() => {
                  const nextMethod =
                    activeLoginMethod === "qr" ? "nsec" : "qr";
                  setActiveLoginMethod(nextMethod);
                  if (nextMethod === "qr" && !nostrConnectUri) {
                    handleQrCodeLogin();
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap ${
                  activeLoginMethod === "qr"
                    ? "bg-foreground/10 text-foreground border-foreground/30"
                    : "bg-muted/50 border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                }`}
                type="button"
              >
                <QrCode className="w-3 h-3" />
                QR Signer
              </button>
              <button
                onClick={() =>
                  setActiveLoginMethod(
                    activeLoginMethod === "bunker" ? "nsec" : "bunker"
                  )
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap ${
                  activeLoginMethod === "bunker"
                    ? "bg-foreground/10 text-foreground border-foreground/30"
                    : "bg-muted/50 border-border text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                }`}
                type="button"
              >
                <Link2 className="w-3 h-3" />
                Bunker
              </button>
            </div>

          </div>

          {activeLoginMethod === "nsec" && (
            <div className={methodCardClass}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <KeyRound className="h-3 w-3" />
                Private key (nsec)
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <input
                    id="login-nsec"
                    type="password"
                    value={loginNsec}
                    onChange={(e) => setLoginNsec(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleKeyLogin();
                      }
                    }}
                    placeholder="nsec1..."
                    className="w-full px-3 py-2 pr-10 bg-background/60 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
                  />
                  <button
                    onClick={handlePasteLoginNsec}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-muted/60 hover:bg-muted border border-border text-foreground p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center"
                    type="button"
                    title="Paste"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  onClick={handleKeyLogin}
                  disabled={isLoggingIn || !loginNsec.trim()}
                  className="shrink-0 inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/60 text-xs font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              <KeyRound className="w-4 h-4" />
              {isLoggingIn ? "Signing In..." : "Sign In"}
            </button>
              </div>
            </div>
          )}

          {activeLoginMethod === "bunker" && (
            <div className={methodCardClass}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="h-3 w-3" />
                Bunker URL
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="bunker://..."
                    value={bunkerUrl}
                    onChange={(e) => setBunkerUrl(e.target.value)}
                    className="w-full px-3 py-2 pr-10 bg-background/60 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
                  />
                  <button
                    onClick={handlePasteBunkerUrl}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-muted/60 hover:bg-muted border border-border text-foreground p-1.5 rounded-md transition-all cursor-pointer flex items-center justify-center"
                    type="button"
                    title="Paste"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  onClick={handleBunkerConnect}
                  disabled={!bunkerUrl || isConnectingBunker}
                  className="shrink-0 inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/60 text-xs font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  type="button"
                >
                  {isConnectingBunker ? (
                    <>
                      <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin"></div>
                      Connecting
                    </>
                  ) : (
                    "Connect"
                  )}
                </button>
              </div>
            </div>
          )}

          {activeLoginMethod === "qr" && (
            <div className={methodCardClass}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <QrCode className="h-3 w-3" />
                QR signer
              </div>
              {nostrConnectUri ? (
                <div className="flex flex-col items-center space-y-3">
                  <p className="text-xs text-muted-foreground text-center">
                    Scan with your Nostr mobile signer
                  </p>
                  <div className="bg-background p-3 rounded-lg">
                    <QRCodeSVG value={nostrConnectUri} size={150} />
                  </div>
                </div>
              ) : isConnectingQR ? (
                <div className="flex flex-col items-center py-3">
                  <div className="w-6 h-6 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin mb-2"></div>
                  <p className="text-xs text-muted-foreground">
                    Generating QR code...
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-center py-2">
                  <button
                    onClick={handleQrCodeLogin}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/60 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors"
                    type="button"
                  >
                    <QrCode className="h-4 w-4" />
                    Generate QR
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  const footerContent = isTopUpPage ? (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            Sign in to sync your wallet
          </p>
          <p className="text-xs text-muted-foreground">
            Optional, but keeps your access across devices.
          </p>
        </div>
        <button
          onClick={() => setActivePage("login")}
          className="shrink-0 px-3 py-2 rounded-md border border-border bg-muted/60 text-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
          type="button"
        >
          Sign in
        </button>
      </div>
    </div>
  ) : (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Need sats?</p>
          <p className="text-xs text-muted-foreground">
            Top up with Lightning, a token, or your wallet.
          </p>
        </div>
        <button
          onClick={() => setActivePage("topup")}
          className="shrink-0 px-3 py-2 rounded-md border border-border bg-muted/60 text-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
          type="button"
        >
          Top up
        </button>
      </div>
    </div>
  );

  const modalContent = (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {modalHeader}
      <div className="flex-1 overflow-y-auto pr-1 transition-all duration-300">
        {isTopUpPage ? topUpContent : loginContent}
      </div>
      <div className="pt-1">{footerContent}</div>
    </div>
  );

  if (!isOpen || !isHydrated) return null;

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent
          className={`bg-card flex flex-col rounded-t-[10px] mt-24 ${dialogHeightClass} outline-none z-[60] overflow-hidden`}
        >
          <div className="pt-4 pb-4 bg-card rounded-t-[10px] flex-1 flex flex-col min-h-0">
            <DrawerTitle className="sr-only">{headerTitle}</DrawerTitle>
            <div
              className={`mx-auto w-full ${modalWidthClass} px-5 flex flex-1 flex-col min-h-0`}
            >
              {modalContent}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <ModalShell
      open={isOpen && isHydrated}
      onClose={onClose}
      overlayClassName="bg-black/60 z-50 p-4"
      contentClassName={`bg-card border border-border rounded-md p-5 w-full ${modalWidthClass} ${dialogHeightClass} transition-all duration-300 overflow-hidden flex flex-col min-h-0`}
      closeOnOverlayClick
    >
      {modalContent}
    </ModalShell>
  );
};

export default TopUpPromptModal;
