"use client";

import React from "react";
import { nip19 } from "nostr-tools";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager, type Account } from "@/features/session/view";
import Light from "../../light/Light";
import { short } from "../../settings/parts";
import { useSwitchAccount } from "../../useSwitchAccount";

/* Who's writing: a first send asks for an account before any sats, because
   sats always belong to one. A new account is one tap, its light shown before
   it exists; a key already on this device, or signing in, also answer it. */
export default function WhoIsWriting({ fresh, signIn }: { fresh: Account; signIn: () => void }) {
  const { manager, session } = useAccountManager();
  const accounts = useObservableState(manager.accounts$) ?? [];
  const switchTo = useSwitchAccount();
  return (
    <div className="pa-view" data-view="who">
      <header className="pa-head">
        <h2 className="pa-t" id="paWhoT">Who&rsquo;s writing?</h2>
      </header>
      <div className="pa-who" role="group" aria-labelledby="paWhoT">
        <button className="pa-who-me" type="button" onClick={() => session.add(fresh, `Account ${accounts.length + 1}`)}>
          <Light pubkey={fresh.pubkey} size={56} />
          <b>New account</b>
        </button>
        {accounts.map((a) => (
          <button key={a.id} className="pa-who-me" type="button" onClick={() => switchTo(a.id)}>
            <Light pubkey={a.pubkey} size={56} />
            <b>{a.metadata?.name || short(nip19.npubEncode(a.pubkey), 9, 4)}</b>
          </button>
        ))}
      </div>
      <button className="pa-link pa-who-in" type="button" onClick={signIn}>
        Sign in
      </button>
    </div>
  );
}
