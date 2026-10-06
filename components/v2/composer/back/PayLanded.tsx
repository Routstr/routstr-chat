"use client";

import React from "react";
import { useUi } from "../../ui";
import { Seal, fmt } from "./bits";

export default function PayLanded({ landed }: { landed: number }) {
  const ui = useUi();
  return (
    <div className="pa-view" data-view="landed">
      <div className="pa-inv" data-paid="" data-landed="">
        <div className="pa-slot">
          <Seal />
        </div>
        <div className="pa-side">
          <p className="pa-amount" data-done="">
            <span className="pa-amount-n">{fmt(landed)}</span>
            <span className="pa-u">sats</span>
          </p>
          <div className="pa-status">
            <p className="pa-line" data-tone="done">
              <span className="pa-dot" aria-hidden="true" />
              Received
            </p>
            <p className="pa-meta">{ui.sendWhenFunded ? "Sending your message now." : "It is in your balance."}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
