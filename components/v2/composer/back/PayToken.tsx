"use client";

import React from "react";
import { Icon } from "../../icons";
import { Warn, fmt, pasteInto } from "./bits";
import { KEPT } from "../../wallet/useFunding";
import type { Pay } from "./usePay";

export default function PayToken({ pay }: { pay: Pay }) {
  const { head, funding, need, balance, read, tok, tokText, setTokText, setTokFail } = pay;
  const sayTok =
    tok === "junk" ? (
      <>
        <Warn />
        That is not a Cashu token. Tokens start with <b>cashuA</b> or&nbsp;<b>cashuB</b>.
      </>
    ) : tok === "error" ? (
      <>
        <Warn />
        {/spent/i.test(funding.message) ? "Someone already spent this token. Nothing changed in your wallet." : "The token could not be received. Nothing changed in your wallet."}
      </>
    ) : tok === "receiving" ? (
      "Receiving from the mint."
    ) : tok === "waiting" ? (
      KEPT
    ) : tok === "read" ? (
      read.kind === "read" && need > 0 && balance + read.sats < need
        ? `This covers part of it. You will need about ${fmt(need - balance - read.sats)} more.`
        : "Ready to receive. Your message sends once it lands."
    ) : (
      <>
        Ecash someone sent you, as text that starts with <b>cashu</b>. It&nbsp;becomes your&nbsp;balance.
      </>
    );
  return (
    <div className="pa-view" data-view="tok">
      <header className="pa-head">
        <h2 className="pa-t">{head.t}</h2>
        {head.s && <p className="pa-sub">{head.s}</p>}
      </header>
      <div className="pa-mid">
        <div className="pa-tokbody">
          {read.kind === "read" ? (
            <div className="pa-tok-read" data-bad={tok === "error" ? "" : undefined}>
              <span className="pa-coin">
                <Icon name={tok === "error" ? "close" : "coin"} size={20} />
              </span>
              <div className="pa-tok-t">
                <p className="pa-amount">
                  <span className="pa-amount-n">{fmt(read.sats)}</span>
                  <span className="pa-u">sats</span>
                </p>
                <p className="pa-meta">
                  from <span className="pa-host">{read.host}</span>
                </p>
              </div>
              <button
                className="pa-link plain"
                data-act="tok-clear"
                type="button"
                style={{ visibility: tok === "read" ? undefined : "hidden" }}
                onClick={() => {
                  setTokText("");
                  setTokFail(false);
                }}
              >
                Clear
              </button>
            </div>
          ) : (
            <div className="pa-tok" data-bad={tok === "junk" ? "" : undefined}>
              <textarea
                id="paTokIn"
                rows={3}
                spellCheck={false}
                autoComplete="off"
                placeholder="cashuB…"
                aria-label="Cashu token"
                aria-describedby="paSay"
                value={tokText}
                onChange={(e) => {
                  setTokText(e.target.value);
                  setTokFail(false);
                }}
              />
              {!tokText && (
                <button className="soft pa-paste" type="button" onClick={() => void pasteInto(setTokText, "#paTokIn")}>
                  <Icon name="paste" size={16} />
                  Paste
                </button>
              )}
            </div>
          )}
        </div>
        <p className="pa-say" id="paSay" data-tone={tok === "junk" || tok === "error" ? "warn" : undefined}>
          {sayTok}
        </p>
      </div>
    </div>
  );
}
