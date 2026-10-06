import { useEffect, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useBusy } from "@/features/chat/view";
import { useNodePays } from "@/features/node/view";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";

/** What you can spend: the wallet plus sats held in provider tokens (the same
 *  figure the old balance showed). `node` is set when a remote node pays. */
export function useMoney() {
  const { balance, isBalanceLoading } = useChat();
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
  }, [paying, balance]);

  return {
    total: balance + pending,
    wallet: balance,
    loading: isBalanceLoading,
    node,
  };
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
