"use client";

import { useCallback, useEffect } from "react";
import { useSession } from "@/features/session/view";
import { useUi } from "../../ui";
import { useMoney } from "../../useMoney";

/* What a send still needs before it can go, in order: someone to write as,
   then sats. Sats always belong to an account, so the account comes first.
   The draft waits in the composer and sends itself once both are there. */
export function useFirstSend(short: boolean) {
  const ui = useUi();
  const { pubkey } = useSession();
  const money = useMoney();
  const loading = !!pubkey && money.loading;
  // a node that pays needs neither
  const need = money.node ? null : !pubkey ? "who" : !loading && money.total <= 0 ? "try" : null;

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
