import { useCallback, useEffect, useRef, useState } from "react";
import { peek, useDepositMint, useMints, usePurse, useWallet } from "@/features/wallet/view";
import { useWalletReceive } from "@/features/wallet/hooks/useWalletReceive";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { useEnsureAccount } from "../useEnsureAccount";

export type FundStatus = "idle" | "creating" | "waiting" | "paid" | "error";

/** What became of a pasted token: the sats that landed, or (pending) the sats
 *  kept while its mint does not answer, which land once it does; "refused"
 *  when nothing was kept (`message` says why); "busy" for a second press while
 *  the first swap runs. */
export type Redeemed = { sats: number; pending: boolean } | "refused" | "busy";

/** What a kept token says: the wallet tries it again on its own. */
export const KEPT = "Kept. Its mint did not answer yet, so these sats come in once it does.";

/* Adding money, for every surface that asks for it. It never handles proofs
   itself: invoices go through useWalletReceive (registered with the invoice
   store before they are shown, minted and saved by that hook, recovered by
   the background checker if this surface closes), tokens through the
   account's purse. This file only sequences and describes. */
export function useFunding() {
  const { balances } = useWallet();
  const { invoices } = useInvoiceSync();
  const cashuStore = useMints();
  const purse = usePurse();
  const ensureAccount = useEnsureAccount();
  const [status, setStatus] = useState<FundStatus>("idle");
  const [amount, setAmount] = useState(0);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [message, setMessage] = useState("");
  const amountRef = useRef(0);

  const done = useCallback((sats: number) => {
    // what actually landed is what the surfaces show and say
    setAmount(sats);
    setStatus("paid");
  }, []);

  const receive = useWalletReceive((tab) => {
    // the hook navigates to "overview" exactly when minted proofs are saved
    if (tab === "overview") done(amountRef.current);
  });

  // the background checker can claim it too: then its own invoice says so.
  // Never a balance that happens to rise by about as much (a refund, an older
  // invoice paid late): that is other money, and this one keeps waiting
  const quoteId = receive.nip60QuoteId;
  const claimed = !!quoteId && invoices.some((i) => i.quoteId === quoteId && (i.state as string) === "ISSUED");
  useEffect(() => {
    if (claimed && status !== "paid") done(amountRef.current);
  }, [claimed, status, done]);

  const [seenError, setSeenError] = useState("");
  if (receive.error !== seenError) {
    setSeenError(receive.error);
    if (receive.error) {
      setMessage(receive.error);
      // an invoice that already exists stays payable; the UI keeps showing it
      setStatus((s) => (s === "paid" ? s : "error"));
    }
  }

  // new money goes where the provider about to be paid can take it
  const depositTo = useDepositMint();
  const [mint, setMint] = useState<string | null>(null);
  const ensureMint = useCallback((sats: number) => {
    const url = depositTo(balances, sats);
    if (!cashuStore.mints.find((m) => m.url === url)) cashuStore.addMint(url);
    if (cashuStore.activeMintUrl !== url) cashuStore.setActiveMintUrl(url);
    setMint(url);
  }, [cashuStore, depositTo, balances]);

  // The invoice is created on the render after the mint is set, so the
  // receive hook sees the active mint it needs. Each request is made once.
  const [queued, setQueued] = useState<{ sats: number } | null>(null);
  const made = useRef<{ sats: number } | null>(null);
  const createInvoice = useCallback(
    (sats: number) => {
      if (!Number.isFinite(sats) || sats <= 0) return;
      setMessage("");
      receive.setError("");
      ensureAccount();
      ensureMint(sats);
      amountRef.current = sats;
      setAmount(sats);
      receive.setMintAmount(String(sats));
      setStatus("creating");
      setQueued({ sats });
    },
    [ensureAccount, ensureMint]
  );

  useEffect(() => {
    if (!queued || made.current === queued || !cashuStore.activeMintUrl) return;
    made.current = queued;
    void receive.createNip60Invoice(queued.sats).then(() =>
      setStatus((s) => (s === "creating" ? "waiting" : s))
    );
  }, [queued, cashuStore.activeMintUrl]);

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage("");
    receive.reset();
  }, [receive.reset]);

  // one swap at a time: a second press while one runs is not a second receive (-1)
  const redeeming = useRef(false);
  const redeemToken = useCallback(
    async (raw: string): Promise<Redeemed> => {
      const token = raw.trim();
      if (!token) return "refused";
      if (redeeming.current) return "busy";
      setMessage("");
      try {
        peek(token);
      } catch {
        setMessage("That does not look like a Cashu token.");
        return "refused";
      }
      setTokenBusy(true);
      redeeming.current = true;
      try {
        ensureAccount();
        const into = purse();
        if (!into) throw new Error("There is no account to receive into.");
        // what the mint gave back, after any input fee; the token's face
        // value is only a promise until the swap
        const got = await into.take(token);
        if (!got.pending) done(got.sats);
        return got;
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "The token could not be received.");
        return "refused";
      } finally {
        redeeming.current = false;
        setTokenBusy(false);
      }
    },
    [ensureAccount, purse, done]
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
    // where the invoice's sats land (the active mint can move on after)
    mint,
    message,
    invoice: receive.nip60Invoice,
    expiresAt: receive.nip60ExpiresAt,
    tokenBusy,
    walletConnected: receive.bcStatus === "connected",
    walletPaying: receive.isBcPaying,
    walletError: receive.bcError,
    createInvoice,
    redeemToken,
    payFromWallet,
    reset,
  };
}
