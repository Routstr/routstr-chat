"use client";

import React from "react";
import { nip19 } from "nostr-tools";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/features/session/view";
import { useUi } from "../ui";
import { readKeyFlag } from "../wallet/bits";
import Light from "../light/Light";
import { Btn, Grp, Head, Row, narrow, short, useCopied } from "./parts";
import SignedOut from "./SignedOut";
import OtherKeys from "./OtherKeys";
import SignOut from "./SignOut";

export default function Account() {
  const { manager } = useAccountManager();
  const accounts = useObservableState(manager.accounts$) || [];
  const active = useObservableState(manager.active$);
  const { done, copy } = useCopied();
  const ui = useUi();

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
  const saved = readKeyFlag(active.pubkey) === "saved";
  const others = accounts.filter((a) => a.id !== active.id);
  return (
    <>
      <Head
        title="Account"
        lede="Your key is your account. No email, no password."
      />
      <Grp id="g-you" k="You">
        <div className="st-id">
          <Light pubkey={active.pubkey} size={44} />
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
          kv={saved ? "Saved" : "Not saved yet"}
          tone={saved ? "ok" : "warn"}
        >
          <Row
            wrap
            title="Secret key"
            note={
              saved
                ? "Saved. On a new device, sign in with it to get your chats and sats back."
                : "Only this browser has it: if site data is cleared, the key goes, and so do the chats and sats it holds."
            }
          >
            <Btn
              icon="key"
              onClick={() => {
                ui.closeSettings();
                ui.setFace("keep");
              }}
            >
              {saved ? "Save again" : "Back up"}
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
