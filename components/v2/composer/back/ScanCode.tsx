"use client";

import React from "react";
import { Icon } from "../../icons";
import Qr from "../Qr";
import { Warn } from "./bits";
import type { SignIn } from "./useSignIn";

export default function ScanCode({ signIn, scan, phone }: { signIn: SignIn; scan: string; phone: boolean }) {
  const { wayState, startScan, stopScan } = signIn;
  return (
    <div className="pa-inv pa-connect">
      <Qr value={scan} state={wayState === "late" ? "stale" : "ready"} label="Code for your signer app" />
      <div className="pa-side">
        <div className="pa-status">
          <p className="pa-line" data-tone={wayState === "late" ? "warn" : undefined}>
            {wayState === "late" ? (
              <>
                <Warn />
                No answer yet
              </>
            ) : (
              <>
                <span className="pa-dot" aria-hidden="true" />
                Waiting for your signer
              </>
            )}
          </p>
          <p className="pa-meta">
            {wayState === "late"
              ? "Codes last a minute. Make a new one when you are ready."
              : phone
                ? "Open your signer app here, or scan this from another phone."
                : "Scan it with your signer app, then approve the request."}
          </p>
        </div>
      </div>
      <div className="pa-acts" data-pair={phone ? "" : undefined}>
        {phone ? (
          <>
            <button className="soft" type="button" onClick={stopScan}>
              <Icon name="link" size={16} />
              Paste a link
            </button>
            {wayState === "late" ? (
              <button className="prime" type="button" onClick={() => void startScan()}>
                <Icon name="retry" size={16} />
                New code
              </button>
            ) : (
              <a className="prime" href={scan}>
                <Icon name="link" size={16} />
                Open app
              </a>
            )}
          </>
        ) : (
          <>
            {wayState === "late" ? (
              <button className="soft" type="button" onClick={() => void startScan()}>
                <Icon name="retry" size={16} />
                New code
              </button>
            ) : (
              <button className="soft" type="button" onClick={() => void navigator.clipboard?.writeText(scan).catch(() => {})}>
                <Icon name="copy" size={16} />
                Copy link
              </button>
            )}
            <button className="pa-link" type="button" onClick={stopScan}>
              Paste a link
            </button>
          </>
        )}
      </div>
    </div>
  );
}
