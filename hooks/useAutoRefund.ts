import { useEffect, useRef } from "react";

const IDLE_MS = 10 * 60 * 1000;

/**
 * Refunds credit when a chat ends: on leaving it, after ten idle minutes, and
 * once per account on app open, for credit a closed tab left behind.
 */
export function useAutoRefund(
  refund: () => Promise<unknown>,
  owner: string | null,
  conversationId: string | null,
  busy: boolean
) {
  const refundRef = useRef(refund);
  refundRef.current = refund;
  const run = () => {
    refundRef.current().catch((error) => {
      console.warn("Automatic refund failed; it will retry later", error);
    });
  };

  useEffect(() => {
    if (owner) run();
  }, [owner]);

  const previous = useRef(conversationId);
  useEffect(() => {
    if (previous.current && previous.current !== conversationId) run();
    previous.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (busy || !owner) return;
    const timer = setTimeout(run, IDLE_MS);
    return () => clearTimeout(timer);
  }, [busy, owner, conversationId]);
}
