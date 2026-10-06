"use client";

import React, { useState } from "react";
import { nip19 } from "nostr-tools";
import { useAccountManager, type Account } from "@/features/session/view";
import {
  calculateBalanceByMint,
  computeTotalBalanceSats,
  holdsRecords,
  useCashuStore,
} from "@/features/wallet";
import { useSwitchAccount } from "../useSwitchAccount";
import Light from "../light/Light";
import { readKeyFlag } from "../wallet/bits";
import { satUnit, sats } from "../format";
import { Btn, Fold, Grp, Ib, Say, narrow, plural, short } from "./parts";

// Another key's coins stay on this device when it is removed, but only that
// key opens them again
const heldBy = (pubkey: string) => {
  const { proofs, mints } = useCashuStore.of(pubkey).getState();
  // counted as the wallet counts its balance: per mint, msat mints in sats
  const { balances, units } = calculateBalanceByMint(proofs, mints);
  // a token not claimed yet, or a payment still settling, is money too (the wallet book)
  return { sats: computeTotalBalanceSats(balances, units), settling: holdsRecords(pubkey) };
};

export default function OtherKeys({ others }: { others: Account[] }) {
  const { session } = useAccountManager();
  const switchTo = useSwitchAccount();
  const [rm, setRm] = useState<string | null>(null);
  return (
    <Grp id="g-others" k="Other keys">
      <div className="st-items">
        {others.map((o) => {
          let n = o.pubkey;
          try {
            n = nip19.npubEncode(o.pubkey);
          } catch {
            // keep the hex
          }
          const held = rm === o.id ? heldBy(o.pubkey) : null;
          const unsaved =
            o.type === "nsec" && readKeyFlag(o.pubkey) !== "saved";
          return (
            <React.Fragment key={o.id}>
              <div className="st-it">
                <Light pubkey={o.pubkey} size={28} />
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
                  warn={unsaved || holds(held)}
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
                  <RemoveNote
                    name={short(n, 12, 6)}
                    held={held}
                    unsaved={unsaved}
                  />
                </Say>
              </Fold>
            </React.Fragment>
          );
        })}
      </div>
    </Grp>
  );
}

type Held = { sats: number; settling: boolean } | null;
const holds = (held: Held) => !!held && (held.sats > 0 || held.settling);

function RemoveNote({
  name,
  held,
  unsaved,
}: {
  name: string;
  held: Held;
  unsaved: boolean;
}) {
  const money = holds(held);
  return (
    <p>
      Remove <b>{name}</b> from this device?{" "}
      {held && money && (
        <>
          It still holds{" "}
          <b>
            {[held.sats > 0 && `${sats(held.sats)} ${satUnit(held.sats)}`, held.settling && "money not settled yet"]
              .filter(Boolean)
              .join(" and ")}
          </b>{" "}
          here. They stay here for this key, and only this key opens them
          again.{" "}
        </>
      )}
      {unsaved
        ? "This device has no record of its secret key being saved. If it is not saved somewhere, nothing can open its sats or chats once it is removed. Switch to it and copy the key first."
        : money
          ? "Back up its key, or switch to it and send the sats out first."
          : "You can add it again with its secret key."}
    </p>
  );
}
