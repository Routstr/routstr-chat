"use client";

import React from "react";

export default function MethodSwitch({ method, setMethod }: { method: "ln" | "token"; setMethod: (m: "ln" | "token") => void }) {
  return (
    <div className="pa-switch" role="radiogroup" aria-label="How to pay" data-m={method}>
      <span className="pa-thumb" aria-hidden="true" />
      {(["ln", "token"] as const).map((m) => (
        <button
          key={m}
          className="pa-seg"
          type="button"
          role="radio"
          aria-checked={method === m}
          tabIndex={method === m ? 0 : -1}
          onClick={() => setMethod(m)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = method === "ln" ? "token" : "ln";
            setMethod(next);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`.pa-seg[aria-checked="true"]`)?.focus());
          }}
        >
          {m === "ln" ? "Lightning" : <>Cashu<span className="pa-long"> token</span></>}
        </button>
      ))}
    </div>
  );
}
