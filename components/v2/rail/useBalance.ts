import { useEffect, useRef, useState } from "react";
import type { useMoney } from "../useMoney";
import { usePendingInvoices } from "../wallet/Wallet";
import { reduced } from "./helpers";

/* ── balance: money in rises beside the number once ─────────────────── */
export function useBalance(money: ReturnType<typeof useMoney>, isAuthenticated: boolean) {
  const [delta, setDelta] = useState<{ n: number; k: number } | null>(null);
  const lastTotal = useRef(money.all);
  const settled = useRef(false);
  useEffect(() => {
    if (money.loading) return;
    const t = window.setTimeout(() => (settled.current = true), 1500);
    return () => window.clearTimeout(t);
  }, [money.loading]);
  useEffect(() => {
    // sats moving to a provider, or coming home, leave the total where it was
    const d = money.all - lastTotal.current;
    lastTotal.current = money.all;
    if (d < 1 || !settled.current || reduced()) return;
    setDelta({ n: d, k: Date.now() });
    const t = window.setTimeout(() => setDelta(null), 1500);
    return () => window.clearTimeout(t);
  }, [money.all]);
  const zero = !money.node && !(money.loading && isAuthenticated) && money.all <= 0;
  // an invoice waiting for payment is never hidden, even with the card on chats
  const pending = usePendingInvoices();
  const waitN = money.node ? 0 : pending.filter((x) => !x.expired).length;
  const balWait = !money.node && money.loading && isAuthenticated;
  return { delta, zero, waitN, balWait };
}
