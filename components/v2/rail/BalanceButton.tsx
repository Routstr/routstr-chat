"use client";

import { sats } from "../format";
import type { useMoney } from "../useMoney";

const compact = (n: number) => {
  n = Math.max(0, Math.floor(n));
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1e6) return `${+(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${+(n / 1e6).toFixed(1)}M`;
};

export function BalanceButton({
  money,
  shown,
  zero,
  balWait,
  waitN,
  delta,
  onClick,
}: {
  money: ReturnType<typeof useMoney>;
  shown: number;
  zero: boolean;
  balWait: boolean;
  waitN: number;
  delta: { n: number; k: number } | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sb-bal"
      data-tipk="bal"
      data-zero={zero ? "" : undefined}
      data-node={money.node ? "" : undefined}
      aria-label={
        money.node
          ? "Open wallet. A remote node pays for replies."
          : balWait
            ? "Open wallet. Balance loading."
            : zero
              ? "Open wallet. Balance 0 sats. Add funds to start chatting."
              : `Open wallet. Balance ${sats(money.total)} sats.${waitN ? ` ${waitN === 1 ? "1 invoice" : `${waitN} invoices`} waiting for payment.` : ""}`
      }
      onClick={onClick}
    >
      <span className="sb-bal-k" aria-hidden="true">
        <span>
          {money.node ? "Paying with" : zero ? "0 sats" : "Balance"}
          {waitN > 0 && (
            <span className="sb-wait">
              <i />
              {waitN} waiting
            </span>
          )}
        </span>
        <span>Open wallet</span>
      </span>
      <span className="sb-bal-v">
        {money.node ? (
          "Your node"
        ) : balWait ? (
          <span className="sb-bal-wait" />
        ) : (
          <>
            <span className="sb-num">{sats(shown)}</span>
            <span className="unit">sats</span>
            <span className="sb-add">Add funds</span>
            {delta && (
              <span className="sb-delta" key={delta.k} aria-hidden="true">
                +{sats(delta.n)}
              </span>
            )}
          </>
        )}
      </span>
      <span className="sb-bal-mini" aria-hidden="true">
        {money.node ? (
          "node"
        ) : balWait ? (
          <span className="sb-bal-wait" style={{ width: 26, height: 8, margin: "2px auto" }} />
        ) : (
          <>
            {compact(shown)}
            <small>sats</small>
          </>
        )}
      </span>
    </button>
  );
}
