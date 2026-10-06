"use client";

import { useCallback, useEffect } from "react";
import { useHeldCredit } from "@/features/chat/view";
import { useSession } from "@/features/session/view";
import { useUi } from "../../ui";
import { useMoney } from "../../useMoney";

/** What a send still needs: someone to write as, then something to pay with
 *  (wallet sats, or credit a provider still holds). A node that pays needs neither. */
export function firstNeed(m: { node: boolean; pubkey: string | null; loading: boolean; total: number; held: number }) {
  if (m.node) return null;
  if (!m.pubkey) return "who" as const;
  return !m.loading && m.total + m.held <= 0 ? ("try" as const) : null;
}

/* What a send still needs before it can go, in order: someone to write as,
   then sats. Sats always belong to an account, so the account comes first.
   The draft waits in the composer and sends itself once both are there. */
export function useFirstSend(short: boolean) {
  const ui = useUi();
  const { pubkey } = useSession();
  const money = useMoney();
  // credit a provider still holds pays the next reply too
  const held = useHeldCredit();
  const loading = !!pubkey && money.loading;
  const need = firstNeed({ node: !!money.node, pubkey, loading, total: money.total, held });

  /** Holds the draft and turns the composer to what it needs. */
  const hold = useCallback(() => {
    ui.setSendWhenFunded(true);
    ui.setFace(need === "who" ? "who" : "pay");
  }, [ui, need]);

  // someone to write as was made, picked or signed in: on to the sats (the
  // held draft still sends by itself if theirs turn up while loading), or,
  // with enough there already, back to the draft, which sends from the composer
  const { face, setFace } = ui;
  useEffect(() => {
    if (face !== "who" || need === "who") return;
    setFace(need === "try" || loading || short ? "pay" : "write");
  }, [face, need, loading, short, setFace]);

  return { need, hold };
}
