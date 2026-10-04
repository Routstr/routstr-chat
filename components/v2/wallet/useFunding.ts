import { useCallback, useEffect, useRef, useState } from "react";
import { getDecodedToken } from "@cashu/cashu-ts";
import { useChat } from "@/context/ChatProvider";
import { useCashuStore, useCashuToken } from "@/features/wallet";
import { useWalletReceive } from "@/features/wallet/hooks/useWalletReceive";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { useEnsureAccount } from "../useEnsureAccount";

export type FundStatus = "idle" | "creating" | "waiting" | "paid" | "error";

/* Adding money, for every surface that asks for it. It never handles proofs
   itself: invoices go through useWalletReceive (registered with the invoice
   store before they are shown, minted and saved by that hook, recovered by
   the background checker if this surface closes), tokens through
   useCashuToken().receiveToken. This file only sequences and describes. */
export function useFunding(onPaid?: (sats: number) => void) {
  const { balance } = useChat();
  const cashuStore = useCashuStore();
  const { receiveToken } = useCashuToken();
  const ensureAccount = useEnsureAccount();
  const [status, setStatus] = useState<FundStatus>("idle");
  const [amount, setAmount] = useState(0);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [message, setMessage] = useState("");
  const baseline = useRef<number | null>(null);
  const amountRef = useRef(0);
  const paidRef = useRef(onPaid);
  paidRef.current = onPaid;

  const done = useCallback((sats: number) => {
    baseline.current = null;
    // what actually landed is what the surfaces show and say
    setAmount(sats);
    setStatus("paid");
    paidRef.current?.(sats);
  }, []);

  const receive = useWalletReceive((tab) => {
    // the hook navigates to "overview" exactly when minted proofs are saved
    if (tab === "overview") done(amountRef.current);
  });

  // the background checker can mint it too; either way the balance rises.
  // Only a rise the size of this invoice counts as this invoice: money from
  // somewhere else (an older invoice paid late, a reply spending) moves the
  // baseline instead, and this one keeps waiting
  useEffect(() => {
    if (status === "paid" || baseline.current === null) return;
    const rise = balance - baseline.current;
    const want = amountRef.current;
    if (rise >= want * 0.98 && rise <= want * 1.02 + 2) done(want);
    else if (rise < 0 || rise > want * 1.02 + 2) baseline.current = balance;
  }, [balance, status, done]);

  useEffect(() => {
    if (receive.error) {
      setMessage(receive.error);
      // an invoice that already exists stays payable; the UI keeps showing it
      setStatus((s) => (s === "paid" ? s : "error"));
    }
  }, [receive.error]);

  const ensureMint = useCallback(() => {
    if (cashuStore.activeMintUrl) return;
    const url = cashuStore.mints[0]?.url || DEFAULT_MINT_URL;
    if (!cashuStore.mints.find((m) => m.url === url)) cashuStore.addMint(url);
    cashuStore.setActiveMintUrl(url);
  }, [cashuStore]);

  // The invoice is created on the render after the mint is set, so the
  // receive hook sees the active mint it needs.
  const [queued, setQueued] = useState<number | null>(null);
  const createInvoice = useCallback(
    (sats: number) => {
      if (!Number.isFinite(sats) || sats <= 0) return;
      setMessage("");
      receive.setError("");
      ensureAccount();
      ensureMint();
      amountRef.current = sats;
      setAmount(sats);
      receive.setMintAmount(String(sats));
      setStatus("creating");
      setQueued(sats);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureAccount, ensureMint]
  );

  useEffect(() => {
    if (queued === null || !cashuStore.activeMintUrl) return;
    setQueued(null);
    baseline.current = balance;
    void receive.createNip60Invoice(queued).then(() =>
      setStatus((s) => (s === "creating" ? "waiting" : s))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, cashuStore.activeMintUrl]);

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage("");
    baseline.current = null;
    receive.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receive.reset]);

  // one swap at a time: a second press while one runs is not a second receive (-1)
  const redeeming = useRef(false);
  const redeemToken = useCallback(
    async (raw: string) => {
      const token = raw.trim();
      if (!token) return 0;
      if (redeeming.current) return -1;
      setMessage("");
      let sats = 0;
      try {
        const decoded = getDecodedToken(token);
        const total = decoded.proofs.reduce((s, p) => s + p.amount, 0);
        sats = decoded.unit === "msat" ? Math.floor(total / 1000) : total;
      } catch {
        setMessage("That does not look like a Cashu token.");
        return 0;
      }
      setTokenBusy(true);
      redeeming.current = true;
      try {
        ensureAccount();
        // what the mint gave back, after any input fee; the token's face
        // value is only a promise until the swap
        const got = await receiveToken(token);
        const back = got.reduce((s, p) => s + p.amount, 0);
        const unit = getDecodedToken(token).unit;
        const landed = got.length ? (unit === "msat" ? Math.floor(back / 1000) : back) : sats;
        done(landed);
        return landed;
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "The token could not be received.");
        return 0;
      } finally {
        redeeming.current = false;
        setTokenBusy(false);
      }
    },
    [ensureAccount, receiveToken, done]
  );

  const payFromWallet = useCallback(async () => {
    if (!receive.nip60Invoice || receive.isBcPaying) return;
    if (receive.bcStatus !== "connected") {
      receive.connectWallet();
      return;
    }
    await receive.handlePayWithBitcoinConnect(receive.nip60Invoice, receive.nip60QuoteId);
  }, [receive]);

  return {
    status,
    amount,
    message,
    invoice: receive.nip60Invoice,
    expiresAt: receive.nip60ExpiresAt,
    tokenBusy,
    walletConnected: receive.bcStatus === "connected",
    walletPaying: receive.isBcPaying,
    createInvoice,
    redeemToken,
    payFromWallet,
    reset,
  };
}
