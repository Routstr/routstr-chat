"use client";

import React, { useRef } from "react";
import { readSecret } from "@/features/session/view";
import { Icon } from "../../icons";
import { Warn, pasteInto } from "./bits";
import type { SignIn } from "./useSignIn";

export default function KeyForm({ signIn }: { signIn: SignIn }) {
  const { wayState, setWayState, keyText, setKeyText, keyPass, setKeyPass, withKey } = signIn;
  const secret = readSecret(keyText);
  const npub = "problem" in secret && secret.problem === "public";
  // a backup file's key is locked: the box asks for its password instead
  const locked = "locked" in secret;
  const bad = wayState === "bad" || wayState === "wrong";
  const file = useRef<HTMLInputElement>(null);
  const open = async (f: File | undefined) => {
    if (!f) return;
    const text = (await f.text()).trim();
    const read = readSecret(text);
    setKeyText("locked" in read ? read.locked : "key" in read ? text : "");
    setWayState("problem" in read ? "bad" : "");
  };
  return (
    <>
      <div className="pa-form">
        <div className="pa-in" data-bad={bad ? "" : undefined}>
          {locked ? (
            <input
              key="pass"
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="Its password"
              aria-label="Backup password"
              aria-describedby="paKeyH"
              value={keyPass}
              onChange={(e) => {
                setKeyPass(e.target.value);
                setWayState("");
              }}
              onKeyDown={(e) => e.key === "Enter" && void withKey()}
            />
          ) : (
            <input
              key="key"
              type="password"
              autoComplete="current-password"
              spellCheck={false}
              placeholder="nsec1…"
              aria-label="Secret key"
              aria-describedby="paKeyH"
              value={keyText}
              onChange={(e) => {
                setKeyText(e.target.value.trim());
                setWayState("");
              }}
              onKeyDown={(e) => e.key === "Enter" && void withKey()}
            />
          )}
          {!locked && (
            <button className="ghost" type="button" aria-label="Paste" title="Paste" onClick={() => void pasteInto(setKeyText, ".pa-way[data-way=key] input")}>
              <Icon name="paste" size={16} />
            </button>
          )}
          <button className="ghost" type="button" aria-label="Open a backup file" title="Open a backup file" onClick={() => file.current?.click()}>
            <Icon name="file" size={16} />
          </button>
          <input ref={file} type="file" accept=".txt,text/plain" hidden onChange={(e) => void open(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
        </div>
        <button
          className="prime"
          type="button"
          onClick={() => void withKey()}
          disabled={locked ? !keyPass || wayState === "busy" : !keyText}
          aria-busy={wayState === "busy" || undefined}
          data-hold={bad ? "" : undefined}
        >
          Sign in
        </button>
      </div>
      <p className="pa-hint" id="paKeyH" data-tone={bad ? "warn" : undefined}>
        {locked ? (
          wayState === "wrong" ? (
            <>
              <Warn />
              <span>That password does not open it. It is the one you picked when you saved the&nbsp;file.</span>
            </>
          ) : (
            <span>
              A backup file. Type the password you picked when you saved it.{" "}
              <button className="pa-link" type="button" onClick={() => (setKeyText(""), setKeyPass(""), setWayState(""))}>
                Use another key
              </button>
            </span>
          )
        ) : wayState !== "bad" ? (
          "Starts with nsec1, or open a backup file. It never leaves this device."
        ) : npub ? (
          <>
            <Warn />
            <span>That is your public key, the one you share. Paste the secret one, it starts with&nbsp;nsec1.</span>
          </>
        ) : (
          <>
            <Warn />
            <span>That is not a secret key or a backup file. A key starts with nsec1 and runs 63&nbsp;characters.</span>
          </>
        )}
      </p>
    </>
  );
}
