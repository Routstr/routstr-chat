"use client";

import { useEffect, useState } from "react";
import { dismissToken, giftFromSeed, usePurse } from "@/features/wallet/view";
import { useUnclaimedTokensStore } from "@/features/wallet/state/unclaimedTokensStore";
import { dropGift, giftIn, type GiftRef } from "./address";
import { useEnsureAccount } from "./useEnsureAccount";
import GiftLight, { type Phase } from "./gift/GiftLight";
import { madeHere, openedHere, rememberOpened } from "./gift/records";

/** The gift a link brought, also when only the hash changes (a link pasted into this tab). */
export function useGiftLink(): GiftRef | null {
  const [gift, setGift] = useState<GiftRef | null>(null);
  useEffect(() => {
    const read = () => setGift(giftIn());
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return gift;
}

/* A gift waits in the room until it is opened by hand: a link opened by a scanner takes
   nothing. Opened, its coins are asked of their mint (nothing is spent by asking), then taken
   as any token's, on a key made here if there is none. A gift opened here before says so; one
   made here is the sender's own, and opening it takes it back, as Take back in Your tokens does. */
export default function GiftArrival({ gift }: { gift: GiftRef }) {
  const purse = usePurse();
  const ensureAccount = useEnsureAccount();
  const [before] = useState(() => openedHere(gift.id));
  const [own] = useState(() => madeHere(gift.id));
  const [phase, setPhase] = useState<Phase>(before ? "again" : "here");
  const [sats, setSats] = useState<number | null>(before?.sats ?? null);
  // the last try did not open it (the mint did not answer): it waits again, and says so
  const [failed, setFailed] = useState(false);
  const memo = gift.memo ?? before?.memo;
  // the sender's own, settled (back, or opened by someone first): as after Take back, it is listed no more
  const unlist = () => {
    const listed = own && useUnclaimedTokensStore.getState().unclaimedTokens.find((t) => t.token === own.token);
    if (listed) dismissToken(listed.id);
  };
  // the key it lands on is made now, while the room arrives, so that work never falls on the moment it opens
  useEffect(() => {
    if (!before) ensureAccount();
  }, [ensureAccount, before]);

  /** Resolves true when it could not be taken and waits again. */
  const take = async () => {
    setPhase("taking");
    setFailed(false);
    try {
      ensureAccount();
      const into = purse();
      if (!into) throw new Error("There is no account to receive into.");
      const token = await giftFromSeed(gift.mint, gift.seed);
      // the mint made no coins for this seed: the link is not whole
      if (!token) {
        dropGift();
        setPhase("empty");
        return false;
      }
      const got = await into.take(token);
      unlist();
      dropGift();
      setSats(got.sats);
      rememberOpened({ id: gift.id, sats: got.sats, memo, at: Date.now() });
      setPhase(got.pending ? "kept" : "landed");
      return false;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/already (spent|claimed|redeemed)/i.test(message)) {
        console.error("The gift could not be taken:", e);
        setFailed(true);
        setPhase("here");
        return true;
      }
      unlist();
      dropGift();
      setPhase("spent");
      return false;
    }
  };

  return <GiftLight memo={memo} sats={sats} own={!!own} phase={phase} failed={failed} take={take} />;
}
