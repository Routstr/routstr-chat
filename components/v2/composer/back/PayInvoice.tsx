"use client";

import React from "react";
import { Icon } from "../../icons";
import { useUi } from "../../ui";
import Qr from "../Qr";
import { Swap, Warn, fmt, nbsp } from "./bits";
import type { Pay } from "./usePay";

export default function PayInvoice({ pay, phone }: { pay: Pay; phone: boolean }) {
  const ui = useUi();
  const { funding, picked, copied, copyInvoice, changeAmount } = pay;
  const s = pay.ln;
  const line =
    s === "making" ? (
      <>
        <span className="spin-s" aria-hidden="true" />
        Making an invoice
      </>
    ) : s === "paid" ? (
      <>
        <span className="pa-dot" aria-hidden="true" />
        Received
      </>
    ) : s === "error" ? (
      <>
        <Warn />
        The mint did not answer
      </>
    ) : s === "stale" ? (
      "This invoice ran out"
    ) : (
      <>
        <span className="pa-dot" aria-hidden="true" />
        Waiting for payment
      </>
    );
  const meta =
    s === "making"
      ? "Your message sends by itself once it is paid."
      : s === "paid"
        ? ui.sendWhenFunded
          ? "Sending your message now."
          : "It is in your balance."
        : s === "error"
          ? nbsp("Nothing was charged. Try again in a moment, or pick another mint in Settings.")
          : s === "stale"
            ? nbsp("Nothing was charged. Make a new one to carry on.")
            : funding.walletPaying
              ? nbsp("Your wallet is paying. Your message sends once it lands.")
              : funding.walletError
                ? nbsp(`Your wallet could not pay: ${funding.walletError}. The invoice still works.`)
                : funding.expiresAt
                  ? nbsp(`Scan with any Lightning wallet. Good until ${new Date(funding.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`)
                  : "Scan with any Lightning wallet.";
  let acts: React.ReactNode = null;
  if (s === "making" && phone) acts = <button className="pa-link" type="button" onClick={changeAmount}>Change amount</button>;
  if (s === "waiting")
    acts = phone ? (
      <button className="pa-link" type="button" onClick={changeAmount}>Change amount</button>
    ) : funding.walletConnected ? (
      <Swap className="soft" icon="copy" idle="Copy invoice" busy="Copied" on={copied} onClick={copyInvoice} mode="copied" />
    ) : (
      <button className="soft" type="button" onClick={() => void funding.payFromWallet()}>
        <Icon name="bolt" size={16} />
        Connect a wallet
      </button>
    );
  return (
    <div className="pa-view" data-view="inv">
      <div className="pa-inv" data-paid={s === "paid" ? "" : undefined} data-error={s === "error" ? "" : undefined}>
        <Qr
          value={funding.invoice || "lnbc"}
          state={s === "making" || s === "error" ? "making" : s === "waiting" ? "ready" : s === "stale" ? "stale" : "done"}
          label="Lightning invoice code"
          onCopy={copyInvoice}
        />
        <div className="pa-side">
          <p className="pa-amount" data-done={s === "paid" ? "" : undefined}>
            <span className="pa-amount-n">{fmt(funding.amount || picked)}</span>
            <span className="pa-u">sats</span>
          </p>
          <div className="pa-status">
            <p className="pa-line" data-tone={s === "paid" ? "done" : s === "error" ? "warn" : undefined}>{line}</p>
            <p className="pa-meta">{meta}</p>
          </div>
        </div>
        {acts && <div className="pa-acts">{acts}</div>}
      </div>
    </div>
  );
}
