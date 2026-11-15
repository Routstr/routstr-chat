"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { nip19 } from "nostr-tools";
import { useObservableState } from "applesauce-react/hooks";
import { lockedSecret, secretOf, useAccountManager } from "@/features/session/view";
import { downloadImageFromSrc } from "@/utils/download";
import { useUi } from "../../ui";
import { readKeyFlag, writeKeyFlag } from "../../wallet/bits";

/* Keeping the key safe on the back of the composer: which way is open, and
   the way it was kept. The ways mirror signing in: a password manager fills
   the Secret key box, and a backup file opens in it. A way counts as kept only
   once the person says so: no browser tells a page that a save went through. */

export type KeepWay = "pm" | "file" | "key";
export type Keep = ReturnType<typeof useKeep>;

type PasswordCredentials = new (data: { id: string; password: string; name?: string }) => Credential;

export function useKeep(say: (t: string) => void) {
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  const nsec = active ? secretOf(active) : null;
  const npub = active ? nip19.npubEncode(active.pubkey) : "";
  const [way, setWay] = useState<KeepWay | null>(null);
  const [kept, setKept] = useState<KeepWay | null>(null);
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [locking, setLocking] = useState(false);
  // the backup file handed to the browser, waiting for the person to see it
  const [file, setFile] = useState<string | null>(null);

  const done = (w: KeepWay) => {
    if (!active) return;
    writeKeyFlag(active.pubkey, "saved");
    setKept(w);
    say(w === "file" ? "Backup file saved." : w === "key" ? "Secret key copied." : "Saved.");
  };

  /** Chrome and its kin save it through the browser's own API; Safari and
   *  Firefox offer to when the form is sent, to a frame that goes nowhere. The
   *  key is in the form only for the moment it is sent. */
  const toManager = (e: React.FormEvent<HTMLFormElement>) => {
    const Credentials = (window as { PasswordCredential?: PasswordCredentials }).PasswordCredential;
    const open = way === "pm";
    setWay(open ? null : "pm");
    if (open || !nsec || Credentials) e.preventDefault();
    if (open || !nsec) return;
    if (Credentials) {
      void navigator.credentials.store(new Credentials({ id: npub, password: nsec, name: "Routstr" })).catch(() => {});
      return;
    }
    const fields = e.currentTarget.elements;
    const fill = (user: string, key: string) => {
      (fields.namedItem("username") as HTMLInputElement).value = user;
      (fields.namedItem("password") as HTMLInputElement).value = key;
    };
    fill(npub, nsec);
    window.setTimeout(() => fill("", ""), 0);
  };

  const short = pass.length < 8;
  const download = async () => {
    if (!active || locking || short || pass !== again) return;
    setLocking(true);
    // locking holds the page a moment: the spinner shows first
    await new Promise((r) => window.setTimeout(r, 40));
    const locked = lockedSecret(active, pass);
    setLocking(false);
    if (!locked) return;
    const text = `${locked}\n\nRoutstr Chat backup for ${npub}, protected by the password you picked.\nTo get back in: open Routstr Chat, Sign in, Secret key, open this file and type that password.\n`;
    const name = `routstr-key-${npub.slice(5, 13)}.txt`;
    void downloadImageFromSrc(new Blob([text], { type: "application/octet-stream" }), name);
    setFile(name);
  };

  const copy = async () => {
    if (!nsec) return;
    try {
      await navigator.clipboard.writeText(nsec);
      done("key");
    } catch {
      // no clipboard: the key stays shown, to copy by hand
    }
  };

  return { npub, nsec, way, setWay, kept, pass, setPass, again, setAgain, short, locking, file, toManager, download, copy, done };
}

/** A held first message sent once its sats landed: when its reply is back and
 *  the key lives only in this browser, the card turns to keeping it safe. */
export function useAskToKeep(asking: boolean) {
  const ui = useUi();
  const { manager } = useAccountManager();
  const held = useRef<"sent" | "asking" | null>(null);
  useEffect(() => {
    if (asking) {
      if (held.current === "sent") held.current = "asking";
      return;
    }
    if (held.current !== "asking") return;
    held.current = null;
    const a = manager.active$.value;
    if (a && secretOf(a) && !readKeyFlag(a.pubkey) && ui.face === "write") ui.setFace("keep");
  }, [asking, manager, ui]);
  return useCallback(() => {
    held.current = "sent";
    // a send that never got going asks nothing, now or at some later reply
    window.setTimeout(() => {
      if (held.current === "sent") held.current = null;
    }, 5000);
  }, []);
}
