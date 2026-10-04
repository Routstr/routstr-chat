"use client";

import React, { useMemo } from "react";
import qrcode from "qrcode-generator";
import { MARK_D } from "../icons";

export type QrState = "making" | "ready" | "done" | "stale";

/* A real QR code, drawn as round dots with rounded eyes and the Routstr mark
   in a clear centre (error correction M still reads it). While the invoice is
   made the mark breathes; the code develops from its centre out; paid, the
   tile folds into the seal with a drawn check (styles in pay.css). */
export default function Qr({
  value,
  state,
  label,
  onCopy,
}: {
  value: string;
  state: QrState;
  label: string;
  onCopy?: () => void;
}) {
  const drawn = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(value || " ");
    q.make();
    const n = q.getModuleCount();
    let hole = Math.round(n * 0.2);
    if (hole % 2 === 0) hole++;
    const h0 = (n - hole) / 2;
    const h1 = h0 + hole;
    const eye = (x: number, y: number) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
    const r = 0.4;
    let d = "";
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!q.isDark(y, x) || eye(x, y)) continue;
        if (x >= h0 - 0.5 && x < h1 + 0.5 && y >= h0 - 0.5 && y < h1 + 0.5) continue;
        d += `M${(x + 0.5 - r).toFixed(2)} ${y + 0.5}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
      }
    return { n, d, c: n / 2, m: hole * 0.78, k: n * 0.039 };
  }, [value]);
  const { n, d, c, m, k } = drawn;
  const copyable = state === "ready" && !!onCopy;

  return (
    <div
      className="pa-qr"
      data-s={state}
      data-copyable={copyable ? "" : undefined}
      role={copyable ? "button" : "img"}
      tabIndex={copyable ? 0 : undefined}
      aria-label={copyable ? `${label}. Copy` : label}
      onClick={copyable ? onCopy : undefined}
      onKeyDown={
        copyable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onCopy?.();
              }
            }
          : undefined
      }
    >
      <svg className="qr-base" viewBox={`0 0 ${n} ${n}`} aria-hidden="true">
        <g className="qr-eyes">
          {[
            [0, 0],
            [n - 7, 0],
            [0, n - 7],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={2} fill="none" stroke="currentColor" strokeWidth={1} />
              <rect x={x + 2} y={y + 2} width={3} height={3} rx={1} fill="currentColor" />
            </g>
          ))}
        </g>
        <svg className="qr-mark" x={c - m / 2} y={c - m / 2} width={m} height={m} viewBox="190 200 640 640">
          <path d={MARK_D} fill="currentColor" />
        </svg>
        {/* the copy glyph spans 4 to 20 of its 24-unit box: sized to the clear centre, like the mark */}
        <g
          className="qr-copy"
          transform={`translate(${c - 12 * (m / 18)} ${c - 12 * (m / 18)}) scale(${m / 18})`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="11" height="11" rx="2.6" />
          <path d="M15.5 5.5A2.5 2.5 0 0 0 13 4H7a3 3 0 0 0-3 3v6a2.5 2.5 0 0 0 1.5 2.3" />
        </g>
        <path
          className="qr-check"
          d="m5.5 12.6 4 4 9-9.2"
          transform={`translate(${c - 12 * k} ${c - 12.6 * k}) scale(${k})`}
          fill="none"
          stroke="currentColor"
          strokeWidth={((n * 0.04) / k).toFixed(3)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={30}
        />
      </svg>
      <svg className="qr-dots" viewBox={`0 0 ${n} ${n}`} aria-hidden="true">
        <path d={d} fill="currentColor" />
      </svg>
    </div>
  );
}
