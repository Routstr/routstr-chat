"use client";

import { useCallback, useEffect } from "react";
import { useObservableState } from "applesauce-react/hooks";
import { useHeldCredit } from "@/features/chat/view";
import { useAccountManager, useSession } from "@/features/session/view";
import { useUi } from "../../ui";
import { useMoney } from "../../useMoney";

/** What a send still needs: something to pay with (wallet sats, or credit a
 *  provider still holds). With no key yet, one is made as the first sats come
 *  in; only keys already on the device ask which one writes. A node that pays
 *  needs neither. */
export function firstNeed(m: { node: boolean; pubkey: string | null; keys: boolean; loading: boolean; total: number; held: number }) {
  if (m.node) return null;
  if (!m.pubkey) return m.keys ? ("who" as const) : ("try" as const);
  return !m.loading && m.total + m.held <= 0 ? ("try" as const) : null;
}

/* What a send still needs before it can go: sats, which always belong to an
   account, so a key on this device is picked first when there are some. The
   draft waits in the composer and sends itself once the sats are there. */
export function useFirstSend(short: boolean) {
  const ui = useUi();
  const { pubkey } = useSession();
  const { manager } = useAccountManager();
  const keys = (useObservableState(manager.accounts$) ?? []).length > 0;
  const money = useMoney();
  // credit a provider still holds pays the next reply too
  const held = useHeldCredit();
  const loading = !!pubkey && money.loading;
  const need = firstNeed({ node: !!money.node, pubkey, keys, loading, total: money.total, held });

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
