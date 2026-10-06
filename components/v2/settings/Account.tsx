"use client";

import React, { useEffect, useState } from "react";
import { nip19 } from "nostr-tools";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/features/session/view";
import { Btn, Grp, Head, Row, narrow, short, useCopied } from "./parts";
import SignedOut from "./SignedOut";
import OtherKeys from "./OtherKeys";
import SignOut from "./SignOut";

export default function Account() {
  const { manager } = useAccountManager();
  const accounts = useObservableState(manager.accounts$) || [];
  const active = useObservableState(manager.active$);
  const { done, copy } = useCopied();
  const [skipped, setSkipped] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  useEffect(
    () => setSkipped(localStorage.getItem("nsec_storing_skipped") === "true"),
    []
  );

  if (!active) return <SignedOut />;

  const npub = (() => {
    try {
      return nip19.npubEncode(active.pubkey);
    } catch {
      return active.pubkey;
    }
  })();
  const nsec = active.type === "nsec";
  const signer = nsec
    ? "Key kept in this browser"
    : active.type === "extension"
      ? "Signed by your browser extension"
      : "Signed by a remote signer";
  const copyNsec = async () => {
    try {
      const key = (active as unknown as { signer: { key: unknown } }).signer
        .key;
      if (
        key instanceof Uint8Array &&
        (await copy(nip19.nsecEncode(key), "nsec"))
      )
        setCopiedKey(true);
    } catch {
      // this key cannot be exported: nothing was copied, so nothing is claimed
    }
  };
  const others = accounts.filter((a) => a.id !== active.id);
  return (
    <>
      <Head
        title="Account"
        lede="Your key is your account. No email, no password."
      />
      <Grp id="g-you" k="You">
        <div className="st-id">
          <span className="st-av lg" aria-hidden="true" />
          <div className="st-id-m">
            <p className="st-id-k" title={npub}>
              {narrow() ? short(npub, 8, 4) : short(npub, 12, 6)}
            </p>
            <p className="st-id-n">{signer}</p>
          </div>
          <Btn
            icon="copy"
            done={done === "npub"}
            label="Copy public key"
            onClick={() => void copy(npub, "npub")}
          >
            {done === "npub" ? "Copied" : "Copy"}
          </Btn>
        </div>
      </Grp>
      {nsec ? (
        <Grp
          id="g-backup"
          k="Backup"
          kv={copiedKey ? "Copied" : skipped ? "Not saved yet" : ""}
          tone={copiedKey ? "ok" : skipped ? "warn" : undefined}
        >
          <Row
            wrap
            title="Secret key"
            note={
              copiedKey
                ? "Copied. Keep it in a password manager, never in a chat. Anyone with it can read your chats and spend your sats."
                : skipped
                  ? "You skipped saving it when you signed up. Only this browser has it: if site data is cleared, the key goes, and so do the chats and sats it holds."
                  : "Anyone with it can read your chats and spend your sats. Keep it somewhere safe."
            }
          >
            <Btn icon="key" done={copiedKey} onClick={() => void copyNsec()}>
              {copiedKey ? "Copied" : "Copy secret key"}
            </Btn>
          </Row>
        </Grp>
      ) : (
        <Grp id="g-backup" k="Backup">
          <Row
            title="Secret key"
            note={
              active.type === "extension"
                ? "It lives in your extension and never reaches this app, so there is nothing to back up here."
                : "It stays with your remote signer, so there is nothing to back up here."
            }
          />
        </Grp>
      )}
      {others.length > 0 && <OtherKeys others={others} />}
      <SignOut />
    </>
  );
}
