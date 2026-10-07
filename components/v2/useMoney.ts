import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useBusy, useKeyCredit } from "@/features/chat/view";
import { useNodePays, type RemoteNode } from "@/features/node/view";
import { useWallet } from "@/features/wallet/view";
import type { Model } from "@/types/models";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import { needOf } from "./price";

export interface Money {
  /** What you can spend: the wallet plus sats held in provider tokens. */
  total: number;
  /** The wallet alone. */
  wallet: number;
  /** The wallet's sats per mint. */
  balances: Record<string, number>;
  /** The wallet's coins may still be arriving. */
  loading: boolean;
  /** Set when a remote node pays. */
  node: RemoteNode | null;
}

/** One reading of the money for the whole screen: the wallet reads its coins
 *  once here, not once per screen that shows a number. The lab fills it with
 *  its own. */
export const MoneyContext = createContext<Money | null>(null);

export function useMoney(): Money {
  const money = useContext(MoneyContext);
  if (!money) throw new Error("useMoney must be used inside MoneyProvider");
  return money;
}

export function MoneyProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const paying = useBusy();
  const node = useNodePays();
  const [pending, setPending] = useState(0);
  const last = useRef(0);

  useEffect(() => {
    const tick = () => {
      const p = getPendingCashuTokenAmount();
      if (p !== last.current) {
        last.current = p;
        setPending(p);
      }
    };
    tick();
    const id = window.setInterval(tick, paying ? 400 : 1500);
    return () => window.clearInterval(id);
  }, [paying, wallet.total]);

  const money = useMemo(
    () => ({ total: wallet.total + pending, wallet: wallet.total, balances: wallet.balances, loading: wallet.loading, node }),
    [wallet.total, wallet.balances, wallet.loading, pending, node]
  );
  return React.createElement(MoneyContext.Provider, { value: money }, children);
}

const slashed = (url: string) => (url.endsWith("/") ? url : `${url}/`);

/** What can pay for a message at a provider, and whether that is enough: the
 *  wallet, and on the API-key path what this account's key there already
 *  holds, which the SDK spends first (`credit` is empty on the X-Cashu path,
 *  which pays every message from the wallet). */
export function payable(total: number, credit: Readonly<Record<string, number>>, node: boolean) {
  const at = (baseUrl: string | null | undefined) => total + (baseUrl ? credit[slashed(baseUrl)] ?? 0 : 0);
  // a node pays for everything; a model with no known price still needs something to pay with
  const covers = (model: Model, baseUrl: string | null | undefined) => {
    if (node) return true;
    const need = needOf(model);
    return need > 0 ? at(baseUrl) >= need : at(baseUrl) > 0;
  };
  return { at, covers };
}

/** `payable` for this account now. The picker and the send both ask it, so
 *  they never disagree. */
export function usePayable() {
  const { total, node } = useMoney();
  const credit = useKeyCredit();
  return useMemo(() => payable(total, credit, !!node), [total, node, credit]);
}

/** A number that counts to its new value once, and never while you read. */
export function useCountUp(target: number, ms = 900) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = target;
    if (a === b) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || Math.abs(b - a) < 1) {
      from.current = b;
      setShown(b);
      return;
    }
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const v = a + (b - a) * e;
      from.current = v;
      setShown(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return shown;
}
