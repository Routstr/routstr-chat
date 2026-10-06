"use client";

import React from "react";
import { Icon } from "../../icons";
import { useUi } from "../../ui";
import { Swap, fmt } from "./bits";
import type { Pay } from "./usePay";

/* the foot: how to pay on the left, the next step on the right */
export function payFoot(pay: Pay, view: string, ui: ReturnType<typeof useUi>, phone: boolean) {
  const { isAuthenticated, funding, ln, tok, read, other, minOther, copied, copyInvoice, changeAmount, makeInvoice, setTokText, setTokFail, receive } = pay;
  const otherN = Number(other || 0);
  let lead: React.ReactNode = null;
  let corner: React.ReactNode = null;
  if (view === "pick") {
    if (other && otherN >= minOther)
      corner = (
        <button className="prime" type="button" onClick={() => makeInvoice(otherN, document.querySelector<HTMLElement>("#paOther"))}>
          Get invoice
        </button>
      );
    else if (!isAuthenticated)
      corner = (
        <button className="pa-link" type="button" onClick={() => ui.setFace("auth")}>
          <span className="pa-long">Have a key? </span>Sign in
        </button>
      );
  } else if (view === "inv") {
    const payBtn = (label: string) => (
      <Swap className="prime" icon="bolt" idle={label} busy="Paying" on={funding.walletPaying} onClick={() => void funding.payFromWallet()} />
    );
    if (ln === "waiting") {
      if (phone) {
        lead = <Swap className="soft" icon="copy" idle="Copy invoice" busy="Copied" on={copied} onClick={copyInvoice} mode="copied" />;
        corner = funding.walletConnected ? (
          payBtn("Pay from wallet")
        ) : (
          <a className="prime" href={`lightning:${(funding.invoice || "").toLowerCase()}`}>
            <Icon name="bolt" size={16} />
            Open wallet
          </a>
        );
      } else {
        lead = (
          <button className="pa-link" type="button" onClick={changeAmount}>
            Change amount
          </button>
        );
        corner = funding.walletConnected ? payBtn("Pay from your wallet") : <Swap className="prime" icon="copy" idle="Copy invoice" busy="Copied" on={copied} onClick={copyInvoice} mode="copied" />;
      }
    } else if (ln === "making") {
      if (!phone)
        lead = (
          <button className="pa-link" type="button" onClick={changeAmount}>
            Change amount
          </button>
        );
    } else if (ln === "stale") {
      lead = (
        <button className="pa-link" type="button" onClick={changeAmount}>
          Change amount
        </button>
      );
      corner = (
        <button className="prime" type="button" onClick={() => makeInvoice(funding.amount)}>
          New invoice
        </button>
      );
    } else if (ln === "error") {
      lead = (
        <button className="pa-link" type="button" onClick={changeAmount}>
          Change amount
        </button>
      );
      corner = (
        <button className="prime" type="button" onClick={() => makeInvoice(funding.amount)}>
          <Icon name="retry" size={16} />
          Try again
        </button>
      );
    }
  } else if (view === "tok") {
    corner =
      tok === "error" ? (
        <button
          className="soft"
          type="button"
          onClick={() => {
            setTokText("");
            setTokFail(false);
          }}
        >
          <Icon name="paste" size={16} />
          Paste another
        </button>
      ) : (
        <Swap
          className="prime"
          icon="download"
          idle={read.kind === "read" && !phone ? `Receive ${fmt(read.sats)} sats` : "Receive"}
          busy="Receiving"
          on={tok === "receiving"}
          onClick={() => void receive()}
          disabled={!(tok === "read" || tok === "receiving")}
        />
      );
  }
  return { lead, corner };
}
