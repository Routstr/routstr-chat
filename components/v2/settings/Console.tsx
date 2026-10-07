"use client";

import React, { useState } from "react";
import { useLogs } from "@/hooks/useLogs";
import { useCoinCount } from "@/features/wallet/view";
import { useActiveMint } from "../wallet/Wallet";
import { satUnit } from "../format";
import { Btn, Grp, Seg, hostOf, n0, plural, useCopied } from "./parts";

export default function Console() {
  const { logs, logCount, clearLogs } = useLogs();
  const coins = useCoinCount();
  const mints = useActiveMint();
  const [view, setView] = useState<"logs" | "wallet">("logs");
  const { done, copy } = useCopied();
  return (
    <>
      <header className="st-head">
        <h2 className="st-t" id="st-title" tabIndex={-1}>
          Console
        </h2>
        <p className="st-lede">
          <span className="st-s">For finding problems.</span>{" "}
          <span className="st-s">Shown only on test builds.</span>
        </p>
        <div className="st-headseg">
          <Seg
            label="View"
            tabs
            opts={[
              ["logs", "Logs"],
              ["wallet", "Wallet state"],
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </header>
      {view === "logs" ? (
        <Grp
          id="g-logs"
          k="Logs"
          kv={logCount ? plural(logCount, "line") : "Empty"}
        >
          <div className="st-logbar" data-anchor="" data-anchor-box="">
            <span className="st-inl">Newest first, this session only</span>
            <span className="grow" />
            <Btn kind="bare" onClick={clearLogs}>
              Clear
            </Btn>
            <Btn
              icon="copy"
              done={done === "logs"}
              onClick={() => void copy(logs.join("\n"), "logs")}
            >
              {done === "logs" ? "Copied" : "Copy all"}
            </Btn>
          </div>
          <div className="st-log scroll" tabIndex={0} aria-label="Console log">
            {[...logs].reverse().join("\n")}
          </div>
        </Grp>
      ) : (
        <Grp id="g-ws" k="Mints" kv={plural(coins, "proof")}>
          <div className="st-items st-ledger">
            {mints.all.map((m) => (
              <div className="st-it noic" key={m.url}>
                <div className="st-it-m">
                  <span className="st-it-t">{hostOf(m.url)}</span>
                  <span className="st-it-s">
                    {m.url === mints.active?.url ? "Pays for replies" : "Held"}
                  </span>
                </div>
                <span className="st-amt">
                  {n0(m.bal)}
                  <span className="u"> {satUnit(m.bal)}</span>
                </span>
              </div>
            ))}
          </div>
        </Grp>
      )}
    </>
  );
}
