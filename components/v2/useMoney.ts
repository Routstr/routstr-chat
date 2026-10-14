import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCatalogService } from "@/features/catalog/view";
import { pricedRequest, questionOf, useBusy, useKeyCredit } from "@/features/chat/view";
import { useThread } from "@/features/history/view";
import { useNodePays, type RemoteNode } from "@/features/node/view";
import { topUpFor } from "@/features/payments/view";
import { useWallet } from "@/features/wallet/view";
import type { Message } from "@/types/chat";
import type { Model } from "@/types/models";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import { useOpenChat } from "./openChat";
import { normalizeModality } from "./picker/modality";
import { useDraft } from "./ui";

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

/** What a send takes from the wallet before it goes, by the SDK's own sizes
 *  (topUpFor), and whether the wallet has it. `spendable` is what one payment
 *  to a provider can draw on: the SDK pays from a single mint the provider
 *  takes (with no provider given, the fullest mint). `need` is what one
 *  message may cost, by the SDK's own rule. On the API-key path a key's credit
 *  at the provider the send goes to pays first; `credit` is null when every
 *  message carries its own token (X-Cashu), and a node pays for all. */
export function payable(
  spendable: (where?: string | null) => number,
  credit: Readonly<Record<string, number>> | null,
  node: boolean,
  need: (model: Model) => number
) {
  const keys = credit ? Object.values(credit) : [];
  // null: no key at that provider yet
  const keyAt = (baseUrl: string | null | undefined) => (credit && baseUrl ? credit[slashed(baseUrl)] ?? null : null);
  const takesWith = (model: Model, key: number | null) =>
    node ? 0 : topUpFor(need(model), key, credit ? "apikeys" : "xcashu").now;
  const takes = (model: Model, where: string | null | undefined) => takesWith(model, keyAt(where));
  /** Whether where the send goes changes the answer: the wallet alone is
   *  short, and the most any key holds would make it enough. */
  const decides = (model: Model) =>
    keys.length > 0 && spendable() < takesWith(model, null) && spendable() >= takesWith(model, Math.max(...keys));
  /** A known `where` counts its own mints and key; one still to work out is
   *  worked out only when a key's credit decides. */
  const covers = (model: Model, where: Where) => {
    if (typeof where !== "function") return spendable(where) >= takes(model, where);
    if (!decides(model)) return spendable() >= takesWith(model, null);
    const at = where();
    return spendable(at) >= takes(model, at);
  };
  return { takes, decides, covers, need, spendable };
}

/** The provider a message goes to, or a way to work it out. */
type Where = string | null | undefined | (() => string | undefined);

export type Payable = ReturnType<typeof payable>;

/** `payable` for this account now, for a send of the draft in the open chat.
 *  The picker and the send both ask it, so they never disagree. */
export function usePayable() {
  const { text, attachments } = useDraft();
  return usePayableFor(useMemo(() => questionOf(text, attachments), [text, attachments]));
}

/** `payable` for a send of `question` in the open chat: what one message may
 *  cost on a model is the SDK's own price for that request (pricedRequest). */
export function usePayableFor(question: Message["content"]) {
  const { balances, node } = useMoney();
  const credit = useKeyCredit();
  const catalog = useCatalogService();
  const slots = useThread(useOpenChat().id);
  const request = useMemo(() => {
    const branch = (slots ?? []).map((s) => s.displayed);
    return { sees: pricedRequest(branch, question, true), reads: pricedRequest(branch, question, false) };
  }, [slots, question]);
  const need = useCallback(
    (model: Model) => catalog?.need(model, textOnly(model) ? request.reads : request.sees) ?? 0,
    [catalog, request]
  );
  const spendable = useCallback(
    (where?: string | null) => {
      const takes = where ? (catalog?.mintsOf(where) ?? []) : [];
      // a provider that names no mints takes any, as the SDK reads it
      return Math.max(0, ...Object.entries(balances).flatMap(([mint, sats]) => (!takes.length || takes.includes(mint) ? [sats] : [])));
    },
    [balances, catalog]
  );
  return useMemo(() => payable(spendable, credit, !!node, need), [spendable, node, credit, need]);
}

// as the engine is told: unknown inputs are not taken as text only
const textOnly = (model: Model) => {
  const inputs = model.architecture?.input_modalities;
  return !!inputs && !inputs.some((m) => normalizeModality(m) === "image");
};

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
