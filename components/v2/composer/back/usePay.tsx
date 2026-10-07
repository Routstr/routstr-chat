"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useHeldCredit } from "@/features/chat/view";
import { useSession } from "@/features/session/view";
import { peek } from "@/features/wallet/view";
import { useUi } from "../../ui";
import { useMoney, usePayable } from "../../useMoney";
import { useChatModel } from "../../useChatModel";
import { useFunding } from "../../wallet/useFunding";
import { PRESETS, fmt, reduced } from "./bits";

/* Adding sats on the back of the composer: which amount, the invoice it made,
   or a pasted token, and what each of them says. Money only moves through
   useFunding (which calls the wallet's own hooks); this sequences and describes. */

export type Pay = ReturnType<typeof usePay>;

const TRY = 100;

export function usePay(say: (t: string) => void) {
  const { model: selectedModel, priced, provider } = useChatModel();
  // what the wallet must hold for the send: the SDK's own top-up, less any key's credit where it goes
  const pay = usePayable();
  const isAuthenticated = useSession().pubkey !== null;
  const ui = useUi();
  const money = useMoney();
  const funding = useFunding();

  const balance = money.total;
  const held = useHeldCredit();
  const need = priced ? pay.takes(priced, provider) : 0;
  // an account's first sats (nothing in the wallet or held at a provider): a small try, picked for you
  const trying = !money.loading && balance + held <= 0 && TRY >= need;

  const [method, setMethod] = useState<"ln" | "token">("ln");
  const [picked, setPicked] = useState(0);
  const [other, setOther] = useState("");
  const [copied, setCopied] = useState(false);
  const [tokText, setTokText] = useState("");
  const [tokFail, setTokFail] = useState(false);
  const [landed, setLanded] = useState(0);

  const minOther = Math.max(1, need - balance);
  // an invoice runs out at the mint's deadline; after that nobody should pay it
  const [ranOut, setRanOut] = useState<number | null>(null);
  useEffect(() => {
    const at = funding.expiresAt;
    if (!at || funding.status !== "waiting") return;
    const t = window.setTimeout(() => setRanOut(at), Math.max(0, at - Date.now()));
    return () => window.clearTimeout(t);
  }, [funding.expiresAt, funding.status]);
  const expired = !!funding.expiresAt && ranOut === funding.expiresAt;
  const ln =
    funding.status === "creating"
      ? "making"
      : funding.status === "waiting"
        ? expired
          ? "stale"
          : "waiting"
        : funding.status === "paid" && method === "ln" && !landed
          ? "paid"
          : funding.status === "error" && funding.amount > 0
            ? "error"
            : "pick";

  // a token pasted: read before receiving, so you see what and from where
  const read = useMemo(() => {
    const t = tokText.trim();
    if (!t) return { kind: "empty" as const };
    if (/^cashu[AB]/.test(t)) {
      try {
        const d = peek(t);
        const sats = d.sats;
        let host = d.mint;
        try {
          host = new URL(d.mint).host;
        } catch {
          // keep the raw mint text
        }
        return { kind: "read" as const, sats, host };
      } catch {
        // falls through to junk once it is long enough to judge
      }
    }
    if ("cashu".startsWith(t.slice(0, 5).toLowerCase()) && t.length < 12) return { kind: "empty" as const };
    return { kind: "junk" as const };
  }, [tokText]);
  const tok = landed
    ? "paid"
    : funding.tokenBusy
      ? "receiving"
      : tokFail && read.kind === "read"
        ? "error"
        : read.kind;

  const view: "pick" | "inv" | "tok" | "landed" = method === "token" ? (tok === "paid" ? "landed" : "tok") : ln === "pick" ? "pick" : "inv";

  /* ── money landed: the seal, the balance rises, the words send ──────── */
  const paidOnce = useRef(false);
  useEffect(() => {
    if (funding.status !== "paid" || paidOnce.current) return;
    paidOnce.current = true;
    say(`Received ${fmt(funding.amount)} sats.${ui.sendWhenFunded ? " Sending your message." : ""}`);
  }, [funding.status, funding.amount, ui.sendWhenFunded, say]);
  // with no held message, the card turns back by itself once the seal has shown
  // (a held one is sent by the composer, which turns the card back itself)
  const { setFace } = ui;
  const holding = ui.sendWhenFunded;
  const settled = funding.status === "paid" || !!landed;
  useEffect(() => {
    if (!settled || holding) return;
    const t = window.setTimeout(() => setFace("write"), 1500);
    return () => window.clearTimeout(t);
  }, [settled, holding, setFace]);
  // a token that covered only part of what the held message needs: after the
  // seal the card goes back to the amounts, whose head says what is still short
  const short = useRef(0);
  useEffect(() => {
    short.current = priced && !pay.covers(priced, provider) ? Math.max(1, need - balance) : 0;
  });
  useEffect(() => {
    if (!landed || !holding) return;
    const t = window.setTimeout(() => {
      if (!short.current) return;
      setLanded(0);
      setTokText("");
      setMethod("ln");
      say(`That covered part of it. Add about ${fmt(short.current)} more sats to send.`);
    }, 1700);
    return () => window.clearTimeout(t);
  }, [landed, holding]);

  /* ── actions ────────────────────────────────────────────────────────── */
  const makeInvoice = (n: number, fromEl?: HTMLElement | null) => {
    setPicked(n);
    setCopied(false);
    // the tapped number flies into the headline
    const fr = fromEl?.getBoundingClientRect();
    funding.createInvoice(n);
    say(`Making an invoice for ${fmt(n)} sats`);
    if (!fr || reduced()) return;
    requestAnimationFrame(() => {
      const to = document.querySelector<HTMLElement>(".pa-inv .pa-amount-n");
      if (!to) return;
      const tr = to.getBoundingClientRect();
      const s = fr.height / tr.height;
      to.animate([{ transform: `translate(${fr.left - tr.left}px, ${fr.bottom - tr.bottom}px) scale(${s})` }, { transform: "none" }], {
        duration: 380,
        easing: "cubic-bezier(.22, 1.02, .32, 1)",
      });
    });
  };

  useEffect(() => {
    if (funding.status === "waiting") say(`Invoice ready for ${fmt(funding.amount)} sats. Waiting for payment.`);
  }, [funding.status, funding.amount, say]);

  const copyInvoice = async () => {
    if (!funding.invoice) return;
    try {
      await navigator.clipboard.writeText(funding.invoice);
      setCopied(true);
      say("Invoice copied");
    } catch {
      // clipboard refused: nothing was copied, so nothing is claimed
    }
  };
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const changeAmount = () => {
    funding.reset();
    paidOnce.current = false;
  };

  const receive = async () => {
    if (read.kind !== "read" || funding.tokenBusy) return;
    setTokFail(false);
    const got = await funding.redeemToken(tokText);
    if (got < 0) return; // a second press while the first swap runs
    if (got) setLanded(got);
    else setTokFail(true);
  };

  // errors are spoken as well as shown
  useEffect(() => {
    if (tok === "error") say(/spent/i.test(funding.message) ? "Someone already spent this token. Nothing changed in your wallet." : "The token could not be received. Nothing changed in your wallet.");
  }, [tok]);
  useEffect(() => {
    if (ln === "error") say("The mint did not answer. Nothing was charged.");
    if (ln === "stale") say("This invoice ran out. Nothing was charged.");
  }, [ln, say]);

  const head = trying
    ? { t: `Try ${fmt(TRY)} sats`, s: null }
    : isAuthenticated && balance > 0
      ? {
          t: "Top up to send",
          s: (
            <>
              You have <b>{fmt(balance)} sats</b>. This model needs <b>{fmt(need)} sats</b>{" "}to start a&nbsp;reply.
            </>
          ),
        }
      : {
          t: "Add a few sats to send",
          s: isAuthenticated
            ? "Your message waits right here and sends itself once they land."
            : "No account needed. Your message waits right here and sends itself once they land.",
        };

  return {
    isAuthenticated,
    head,
    presets: trying ? [TRY, ...PRESETS.slice(0, 2)] : PRESETS,
    funding,
    balance,
    need,
    minOther,
    method,
    setMethod,
    picked: picked || (trying ? TRY : 0),
    other,
    setOther,
    copied,
    tokText,
    setTokText,
    setTokFail,
    landed,
    ln,
    read,
    tok,
    view,
    makeInvoice,
    copyInvoice,
    changeAmount,
    receive,
  };
}
