"use client";

import { useEffect, useRef, useState } from "react";
import { ExtensionAccount, NostrConnectAccount, PrivateKeyAccount } from "applesauce-accounts/accounts";
import { NostrConnectSigner } from "applesauce-signers";
import {
  useAccountManager,
  type Account,
  type AccountMetadata,
} from "@/features/session/view";
import { useUi } from "../../ui";
import { touch } from "./bits";

/* Signing in on the back of the composer: which way is open, what was typed
   there, and the key it ends in. */

export type Way = null | "ext" | "key" | "bunker";
export type SignIn = ReturnType<typeof useSignIn>;

export function useSignIn(say: (t: string) => void, from: "pay" | "write") {
  const ui = useUi();
  const { manager, session } = useAccountManager();
  const [way, setWay] = useState<Way>(null);
  const [wayState, setWayState] = useState<"" | "busy" | "bad" | "late">("");
  const [keyText, setKeyText] = useState("");
  const [bunkerText, setBunkerText] = useState("");
  const [scan, setScan] = useState<string | null>(null);
  const [done, setDone] = useState<null | "in" | "new">(null);

  const count = () => manager.accounts$.value.length + 1;
  const adopt = (account: Account, kind: "in" | "new", name?: string) => {
    session.add(account, name);
    setWay(null);
    setWayState("");
    setDone(kind);
    say(kind === "new" ? "A new key was made on this device." : "Signed in.");
  };
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => {
      setDone(null);
      ui.setFace(from === "pay" || ui.sendWhenFunded ? "pay" : "write");
    }, 1700);
    return () => window.clearTimeout(t);
  }, [done, from, ui]);

  const extension = async () => {
    setWay("ext");
    setWayState("busy");
    try {
      adopt(await ExtensionAccount.fromExtension(), "in");
    } catch {
      setWayState("bad");
    }
  };
  const nsecOk = (v: string) => /^nsec1[02-9ac-hj-np-z]{58}$/.test(v) || /^[0-9a-f]{64}$/i.test(v);
  const withKey = () => {
    const v = keyText.trim();
    if (!v) return;
    if (!nsecOk(v)) {
      setWayState("bad");
      return;
    }
    try {
      adopt(PrivateKeyAccount.fromKey<AccountMetadata>(v), "in", `Account ${count()}`);
      setKeyText("");
    } catch {
      setWayState("bad");
    }
  };
  const bunker = async () => {
    const v = bunkerText.trim();
    if (!v || wayState === "busy") return;
    setWayState("busy");
    try {
      const signer = await NostrConnectSigner.fromBunkerURI(v);
      const pubkey = await signer.getPublicKey();
      adopt(new NostrConnectAccount<AccountMetadata>(pubkey, signer), "in", `Bunker ${count()}`);
      setBunkerText("");
    } catch {
      setWayState("bad");
    }
  };
  const scanRun = useRef(0);
  const startScan = async () => {
    const id = ++scanRun.current;
    setWayState("");
    const signer = new NostrConnectSigner({ relays: ["wss://relay.nsec.app"] });
    setScan(signer.getNostrConnectURI({ name: "Routstr Chat" }));
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 60_000);
    try {
      await signer.waitForSigner(ctrl.signal);
      if (id !== scanRun.current) return;
      const pubkey = await signer.getPublicKey();
      adopt(new NostrConnectAccount<AccountMetadata>(pubkey, signer), "in", `Bunker ${count()}`);
      setScan(null);
    } catch {
      if (id === scanRun.current) setWayState("late");
    } finally {
      window.clearTimeout(timeout);
    }
  };
  const stopScan = () => {
    scanRun.current++;
    setScan(null);
    setWayState("");
  };
  const fresh = () => adopt(PrivateKeyAccount.generateNew<AccountMetadata>(), "new", `Account ${count()}`);
  const openWay = (w: Way) => {
    stopScan();
    setWayState("");
    setWay((cur) => (cur === w ? null : w));
    if (w && !touch()) window.setTimeout(() => document.querySelector<HTMLInputElement>(`.pa-way[data-way="${w}"] input`)?.focus(), 90);
  };
  const [hasExt, setHasExt] = useState(false);
  useEffect(() => setHasExt(!!(window as unknown as { nostr?: unknown }).nostr), []);

  return {
    way,
    setWay,
    wayState,
    setWayState,
    keyText,
    setKeyText,
    bunkerText,
    setBunkerText,
    scan,
    done,
    hasExt,
    extension,
    withKey,
    bunker,
    startScan,
    stopScan,
    fresh,
    openWay,
  };
}
