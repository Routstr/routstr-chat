"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import type { AccountMetadata } from "@/features/session/view";
import { useUi } from "../../ui";
import { phoneNow } from "./bits";
import { usePay } from "./usePay";
import { useSignIn } from "./useSignIn";
import { payFoot } from "./payFoot";
import { useCardFocus, useCardHeight, usePaidCentre, useViewSwap } from "./card";
import PayPick from "./PayPick";
import PayInvoice from "./PayInvoice";
import PayToken from "./PayToken";
import PayLanded from "./PayLanded";
import SignInWays from "./SignInWays";
import SignInDone from "./SignInDone";
import WhoIsWriting from "./WhoIsWriting";
import MethodSwitch from "./MethodSwitch";

/* The back of the composer: who is writing, add a few sats, or sign in. The
   words stay on the band above; this card beneath is a tone deeper and shows
   one thing at a time. */

export default function Back({
  face,
  island,
}: {
  face: "pay" | "auth" | "who";
  island: React.RefObject<HTMLDivElement | null>;
}) {
  const ui = useUi();
  const phone = phoneNow();
  const [from] = useState<"pay" | "write" | "who">(() => (face === "who" ? "who" : ui.sendWhenFunded ? "pay" : face === "auth" ? "write" : "pay"));
  const live = useRef<HTMLParagraphElement>(null);
  const say = useCallback((t: string) => {
    const el = live.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => (el.textContent = t));
  }, []);
  const pay = usePay(say);
  // the new account offered on "Who's writing?": one key for as long as the card is up
  const [fresh] = useState(() => PrivateKeyAccount.generateNew<AccountMetadata>());
  const signIn = useSignIn(say, from === "who" ? "pay" : from);
  const { way, setWay, stopScan } = signIn;
  const view = face === "who" ? "who" : face === "auth" ? (signIn.done ? "done" : "auth") : pay.view;

  // back goes up one level: an open way, then out of sign in
  const back = useCallback(() => {
    if (face === "auth" && way && way !== "ext") {
      stopScan();
      setWay(null);
      return;
    }
    if (face === "auth" && from !== "write") return ui.setFace(from);
    ui.setSendWhenFunded(false);
    ui.setFace("write");
  }, [face, way, from, ui]);

  // Esc does the same, from anywhere on the card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!island.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      e.preventDefault();
      back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, island]);

  const body =
    view === "pick" ? (
      <PayPick key="pick" pay={pay} />
    ) : view === "inv" ? (
      <PayInvoice key="inv" pay={pay} phone={phone} />
    ) : view === "tok" ? (
      <PayToken key="tok" pay={pay} />
    ) : view === "landed" ? (
      <PayLanded key="landed" landed={pay.landed} />
    ) : view === "done" ? (
      <SignInDone key="done" done={signIn.done} />
    ) : view === "who" ? (
      <WhoIsWriting key="who" fresh={fresh} signIn={() => ui.setFace("auth")} />
    ) : (
      <SignInWays key="auth" signIn={signIn} back={back} from={from} phone={phone} />
    );

  const { lead, corner } = payFoot(pay, view, ui, phone);
  const showSwitch = view === "pick" || view === "tok";
  const footHidden = face !== "pay" || view === "landed" || (view === "inv" && !lead && !corner);
  const pair = view === "inv" && phone && pay.ln === "waiting";
  const solo = showSwitch && !lead && !corner;

  const morph = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  useCardHeight(morph, stage, foot, island, footHidden, view);
  const { arriving, leaving } = useViewSwap(view, body);
  useCardFocus(morph, `${face}:${view}:${pay.tok === "error"}:${pay.ln === "stale"}`);
  usePaidCentre(stage, view, pay.ln);

  return (
    <div className="pa-card">
      <div className="pa-morph" ref={morph}>
        <div className="pa-inwrap">
          <div className="pa-stage" ref={stage}>
            {leaving && leaving.key !== view && (
              <div className="pa-out" aria-hidden="true" inert>
                {leaving.node}
              </div>
            )}
            <div className="pa-cur" data-in={leaving ? "" : undefined} data-arriving={arriving ? "" : undefined}>
              {body}
            </div>
          </div>
          <div className="pa-foot" ref={foot} hidden={footHidden} data-pair={pair ? "" : undefined} data-solo={solo ? "" : undefined}>
            {showSwitch && <MethodSwitch method={pay.method} setMethod={pay.setMethod} />}
            {lead && <div className="pa-lead">{lead}</div>}
            <div className="pa-corner">{corner}</div>
          </div>
        </div>
      </div>
      <p className="sr" aria-live="polite" ref={live} />
    </div>
  );
}
