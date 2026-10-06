"use client";

import React from "react";
import { readSecret } from "@/features/session/view";
import { Icon } from "../../icons";
import { Warn, pasteInto } from "./bits";
import type { SignIn } from "./useSignIn";

export default function KeyForm({ signIn }: { signIn: SignIn }) {
  const { wayState, setWayState, keyText, setKeyText, withKey } = signIn;
  const secret = readSecret(keyText);
  const npub = "problem" in secret && secret.problem === "public";
  return (
    <>
      <div className="pa-form">
        <div className="pa-in" data-bad={wayState === "bad" ? "" : undefined}>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="nsec1…"
            aria-label="Secret key"
            aria-describedby="paKeyH"
            value={keyText}
            onChange={(e) => {
              setKeyText(e.target.value.trim());
              setWayState("");
            }}
            onKeyDown={(e) => e.key === "Enter" && withKey()}
          />
          <button className="ghost" type="button" aria-label="Paste" title="Paste" onClick={() => void pasteInto(setKeyText, ".pa-way[data-way=key] input")}>
            <Icon name="paste" size={16} />
          </button>
        </div>
        <button className="prime" type="button" onClick={withKey} disabled={!keyText} data-hold={wayState === "bad" ? "" : undefined}>
          Sign in
        </button>
      </div>
      <p className="pa-hint" id="paKeyH" data-tone={wayState === "bad" ? "warn" : undefined}>
        {wayState !== "bad" ? (
          "Starts with nsec1. It never leaves this device."
        ) : npub ? (
          <>
            <Warn />
            <span>That is your public key, the one you share. Paste the secret one, it starts with&nbsp;nsec1.</span>
          </>
        ) : (
          <>
            <Warn />
            <span>That is not a secret key. It starts with nsec1 and runs 63&nbsp;characters.</span>
          </>
        )}
      </p>
    </>
  );
}
