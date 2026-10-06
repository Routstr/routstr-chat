"use client";

import React from "react";
import { fmt } from "./bits";
import type { Pay } from "./usePay";

export default function PayPick({ pay }: { pay: Pay }) {
  const { head, presets, balance, need, minOther, picked, other, setOther, makeInvoice } = pay;
  const firstOk = presets.find((n) => n + balance >= need);
  const otherN = Number(other || 0);
  const amtKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const all = Array.from(document.querySelectorAll<HTMLElement>(".pa-amt[data-n]:not([aria-disabled])"));
    const i = all.indexOf(e.currentTarget) + (e.key === "ArrowRight" ? 1 : -1);
    e.preventDefault();
    if (i >= all.length) return document.querySelector<HTMLInputElement>("#paOther")?.focus();
    all[Math.max(0, i)]?.focus();
  };
  return (
    <div className="pa-view" data-view="pick">
      <header className="pa-head">
        <h2 className="pa-t" id="paTitle">{head.t}</h2>
        {head.s && <p className="pa-sub">{head.s}</p>}
      </header>
      <div className="pa-pickbody">
        <div className="pa-amts" role="group" aria-labelledby="paTitle">
          {presets.map((n) => {
            const low = n + balance < need;
            const stop = presets.includes(picked) ? n === picked : n === firstOk;
            return (
              <button
                key={n}
                className="pa-amt"
                type="button"
                data-n={n}
                data-picked={picked === n ? "" : undefined}
                tabIndex={stop ? 0 : -1}
                aria-disabled={low || undefined}
                onKeyDown={amtKey}
                onClick={(e) => !low && makeInvoice(n, e.currentTarget.querySelector<HTMLElement>(".pa-n"))}
              >
                <span className="pa-num">
                  <span className="pa-n">{fmt(n)}</span>
                  <span className="pa-u">sats</span>
                </span>
                <span className="pa-r">{low && "too little"}</span>
              </button>
            );
          })}
          <label className="pa-amt pa-other" data-has={other ? "" : undefined} data-long={other.length > 5 ? "" : undefined} data-bad={other && otherN < minOther ? "" : undefined}>
            <span className="pa-num">
              <span className="pa-o">
                <span className="pa-o-size" aria-hidden="true">{other ? fmt(otherN) : "Other"}</span>
                <input
                  id="paOther"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Other"
                  aria-label="Other amount in sats"
                  aria-describedby="paOtherR"
                  value={other ? fmt(otherN) : ""}
                  onChange={(e) => setOther(e.target.value.replace(/[^\d]/g, "").replace(/^0+/, "").slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && otherN >= minOther) {
                      e.preventDefault();
                      makeInvoice(otherN, e.currentTarget);
                    }
                  }}
                />
              </span>
              {other && <span className="pa-u">{otherN === 1 ? "sat" : "sats"}</span>}
            </span>
            <span className="pa-r" id="paOtherR">
              {!other ? "any amount" : otherN < minOther ? `at least ${fmt(minOther)}` : ""}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
