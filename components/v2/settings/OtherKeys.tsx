"use client";

import React, { useState } from "react";
import { nip19 } from "nostr-tools";
import { useAccountManager, type Account } from "@/features/session/view";
import { useCashuStore } from "@/features/wallet";
import { useUnclaimedTokensStore } from "@/features/wallet/state/unclaimedTokensStore";
import { useSwitchAccount } from "../useSwitchAccount";
import { Btn, Fold, Grp, Ib, Say, narrow, short } from "./parts";

// Another key's coins stay on this device when it is removed, but only that
// key opens them again
const holdsMoney = (pubkey: string) =>
  useCashuStore.of(pubkey).getState().proofs.length > 0 ||
  useUnclaimedTokensStore.of(pubkey).getState().unclaimedTokens.length > 0;

export default function OtherKeys({ others }: { others: Account[] }) {
  const { session } = useAccountManager();
  const switchTo = useSwitchAccount();
  const [rm, setRm] = useState<string | null>(null);
  return (
    <Grp id="g-others" k="Other keys">
      <div className="st-items">
        {others.map((o, i) => {
          let n = o.pubkey;
          try {
            n = nip19.npubEncode(o.pubkey);
          } catch {
            // keep the hex
          }
          return (
            <React.Fragment key={o.id}>
              <div className="st-it">
                <span
                  className="st-av"
                  style={
                    { "--av-a": `${40 + i * 90}deg` } as React.CSSProperties
                  }
                  aria-hidden="true"
                />
                <div className="st-it-m">
                  <span className="st-it-t mono">
                    {narrow() ? short(n, 8, 4) : short(n, 12, 6)}
                  </span>
                  <span className="st-it-s">
                    {o.type === "nsec"
                      ? "Key kept in this browser"
                      : o.type === "extension"
                        ? "Browser extension"
                        : "Remote signer"}
                  </span>
                </div>
                <div className="st-it-r">
                  <Ib
                    icon="trash"
                    label="Remove this key"
                    hov
                    controls={`f-rmkey-${o.id}`}
                    open={rm === o.id}
                    onClick={() => setRm(rm === o.id ? null : o.id)}
                  />
                  <Btn onClick={() => switchTo(o.id)}>Switch</Btn>
                </div>
              </div>
              <Fold id={`f-rmkey-${o.id}`} open={rm === o.id}>
                <Say
                  inset="l"
                  acts={
                    <>
                      <Btn onClick={() => setRm(null)}>Keep it</Btn>
                      <Btn
                        kind="warn"
                        icon="trash"
                        onClick={() => {
                          session.remove(o.id);
                          setRm(null);
                        }}
                      >
                        Remove
                      </Btn>
                    </>
                  }
                >
                  <p>
                    Remove <b>{short(n, 12, 6)}</b> from this device?{" "}
                    {rm === o.id && holdsMoney(o.pubkey)
                      ? "It still holds sats here. They stay here for this key, and only this key opens them again. Back up its key, or switch to it and send the sats out first."
                      : "You can add it again with its secret key."}
                  </p>
                </Say>
              </Fold>
            </React.Fragment>
          );
        })}
      </div>
    </Grp>
  );
}
