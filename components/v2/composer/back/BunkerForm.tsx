"use client";

import React from "react";
import { Icon } from "../../icons";
import { Swap, Warn, pasteInto } from "./bits";
import type { SignIn } from "./useSignIn";

export default function BunkerForm({ signIn }: { signIn: SignIn }) {
  const { wayState, setWayState, bunkerText, setBunkerText, bunker, startScan } = signIn;
  return (
    <>
      <div className="pa-form">
        <div className="pa-in" data-bad={wayState === "bad" ? "" : undefined}>
          <input
            autoComplete="off"
            spellCheck={false}
            placeholder="bunker://…"
            aria-label="Signer link"
            aria-describedby="paBunkerH"
            readOnly={wayState === "busy"}
            value={bunkerText}
            onChange={(e) => {
              setBunkerText(e.target.value.trim());
              setWayState("");
            }}
            onKeyDown={(e) => e.key === "Enter" && void bunker()}
          />
          <button className="ghost" type="button" aria-label="Paste" title="Paste" onClick={() => void pasteInto(setBunkerText, ".pa-way[data-way=bunker] input")}>
            <Icon name="paste" size={16} />
          </button>
        </div>
        <Swap className="prime" icon="link" idle="Connect" busy="Connecting" on={wayState === "busy"} onClick={() => void bunker()} disabled={!bunkerText} />
      </div>
      <p className="pa-hint" id="paBunkerH" data-tone={wayState === "bad" ? "warn" : undefined}>
        {wayState === "busy" ? (
          "Approve the request in your signer app."
        ) : wayState === "bad" ? (
          <>
            <Warn />
            <span>The signer did not answer. Check the link, then try&nbsp;again.</span>
          </>
        ) : (
          <>
            Paste the bunker link your signer app gives you.{" "}
            <button className="pa-link" type="button" onClick={() => void startScan()}>
              Or scan a code instead
            </button>
          </>
        )}
      </p>
    </>
  );
}
