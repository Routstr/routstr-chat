"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ExtensionAccount, PrivateKeyAccount } from "applesauce-accounts/accounts";
import {
  fromBunkerLink,
  readSecret,
  signerByCode,
  useAccountManager,
  type Account,
  type AccountMetadata,
} from "@/features/session/view";
import { useUi } from "../../ui";
import { writeKeyFlag } from "../../wallet/bits";
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
  const withKey = () => {
    if (!keyText) return;
    const secret = readSecret(keyText);
    if (!("key" in secret)) return setWayState("bad");
    try {
      const account = PrivateKeyAccount.fromKey<AccountMetadata>(secret.key);
      adopt(account, "in", `Account ${count()}`);
      // a key pasted in is a key already kept somewhere else
      writeKeyFlag(account.pubkey, "saved");
      setKeyText("");
    } catch {
      // 64 hex characters that are not a valid key
      setWayState("bad");
    }
  };
  const bunker = async () => {
    const v = bunkerText.trim();
    if (!v || wayState === "busy") return;
    setWayState("busy");
    try {
      adopt(await fromBunkerLink(v), "in", `Bunker ${count()}`);
      setBunkerText("");
    } catch {
      setWayState("bad");
    }
  };
  // the code shown now; stopping it also stops listening for the signer app
  const listening = useRef<AbortController | null>(null);
  useEffect(() => () => listening.current?.abort(), []);
  const startScan = async () => {
    listening.current?.abort();
    const ctrl = (listening.current = new AbortController());
    setWayState("");
    const code = signerByCode(["wss://relay.nsec.app"], "Routstr Chat");
    setScan(code.uri);
    const timeout = window.setTimeout(() => ctrl.abort(), 60_000);
    try {
      const account = await code.account(ctrl.signal);
      if (listening.current !== ctrl) return;
      adopt(account, "in", `Bunker ${count()}`);
      setScan(null);
    } catch {
      if (listening.current === ctrl) setWayState("late");
    } finally {
      window.clearTimeout(timeout);
    }
  };
  const stopScan = () => {
    const ctrl = listening.current;
    listening.current = null;
    ctrl?.abort();
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
  const hasExt = useSyncExternalStore(
    () => () => {},
    () => !!(window as unknown as { nostr?: unknown }).nostr,
    () => false
  );

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
