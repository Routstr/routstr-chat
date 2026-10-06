"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Icon } from "../icons";
import { tokenMs } from "../motion";

/* The small shared pieces of the wallet (the back of the rail card). */

export const fmt = (n: number) => Math.max(0, Math.floor(n)).toLocaleString("en-US");
export const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const phoneNow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
export const host = (u?: string | null) => {
  if (!u) return "";
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
/** A mint by its own name, or its host. */
export const mintLabel = (m?: { url: string; mintInfo?: { name?: string } } | null) => (m ? m.mintInfo?.name?.trim() || host(m.url) : "");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Whether this browser's key was backed up ("saved") or its reminder waved away ("hidden"), per account. */
export const keyFlag = (pubkey: string) => `routstr.keysaved:${pubkey}`;
export function readKeyFlag(pubkey?: string): string | null {
  try {
    return pubkey ? localStorage.getItem(keyFlag(pubkey)) : null;
  } catch {
    return null;
  }
}
export function writeKeyFlag(pubkey: string, v: "saved" | "hidden") {
  try {
    localStorage.setItem(keyFlag(pubkey), v);
  } catch {
    // storage blocked: the reminder simply shows again next time
  }
}

/** Seconds or milliseconds, as the stores keep them. */
export const toMs = (t?: number) => (!t ? 0 : t < 1e12 ? t * 1000 : t);

/** A reply pays first and gets its change back just after: money coming in within two minutes is the
 *  change of the newest payment still waiting that paid at least as much. Replies run one after
 *  another, so the newest one is the one that just ended. Anything else coming in is a top-up. */
export function pairChange<E extends { id: string; direction: string; amount: string | number; timestamp?: number }>(entries: E[]) {
  const sorted = [...entries].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
  const changeOf = new Map<string, E>();
  const taken = new Set<string>();
  const waiting: E[] = [];
  for (const e of sorted) {
    if (e.direction === "out") {
      waiting.push(e);
      continue;
    }
    for (let k = waiting.length - 1; k >= 0; k--) {
      const p = waiting[k];
      if (toMs(e.timestamp) - toMs(p.timestamp) > 120_000) break;
      if (Number(p.amount) < Number(e.amount)) continue;
      changeOf.set(p.id, e);
      taken.add(e.id);
      waiting.splice(k, 1);
      break;
    }
  }
  return { sorted, changeOf, taken };
}
const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const md = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const midnight = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();
export function dayOf(t: number) {
  const s = midnight();
  if (t >= s) return "Today";
  if (t >= s - DAY) return "Yesterday";
  if (t >= s - 7 * DAY) return "Previous 7 days";
  if (t >= s - 30 * DAY) return "Previous 30 days";
  return "Older";
}
export function ago(t: number) {
  const d = Date.now() - t;
  if (d < 45_000) return "just now";
  if (d < HOUR) return `${Math.round(d / MIN)} min ago`;
  if (t >= midnight()) return `${Math.round(d / HOUR)} h ago`;
  if (t >= midnight() - DAY) return `yesterday, ${hm(t)}`;
  return `${md(t)}, ${hm(t)}`;
}
/** Inside a day group the day is already said, so only the rest is. */
export function whenIn(t: number) {
  const g = dayOf(t);
  if (g === "Today") return ago(t);
  if (g === "Yesterday") return hm(t);
  return `${md(t)}, ${hm(t)}`;
}
/** A short range for a folded run: "17:33", "Sep 25", "Sep 24 to 26". */
export function span(a: number, b: number) {
  const g = dayOf(a);
  if (md(a) === md(b)) return g === "Today" || g === "Yesterday" ? whenIn(b) : md(a);
  const A = new Date(a);
  const B = new Date(b);
  return A.getMonth() === B.getMonth() ? `${md(a)} to ${B.getDate()}` : `${md(a)} to ${md(b)}`;
}
export function left(t: number) {
  const m = Math.max(1, Math.round((t - Date.now()) / MIN));
  return m < 60 ? `${m} more min` : `${Math.round(m / 60)} more ${Math.round(m / 60) === 1 ? "hour" : "hours"}`;
}

/* ── the number: an odometer ─────────────────────────────────────────────── */
const STRIP = Array.from({ length: 10 }, (_, i) => <span key={i}>{i}</span>);
export const numSize = (s: string) => (s.length <= 5 ? 52 : s.length <= 7 ? 46 : s.length <= 9 ? 38 : 32) + (phoneNow() ? 4 : 0);

/** Each digit is a column that rolls to its value, right to left; digits keep
 *  their own widths, measured in the room's face once the fonts are in. */
export function Odometer({ value }: { value: number }) {
  const s = fmt(value);
  const el = useRef<HTMLSpanElement>(null);
  const prev = useRef<string | null>(null);
  const [w, setW] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const box = el.current;
      if (!box) return;
      const m = document.createElement("span");
      m.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      m.innerHTML = "0123456789".split("").map((c) => `<span>${c}</span>`).join("");
      box.appendChild(m);
      setW(Array.from(m.children, (c) => c.getBoundingClientRect().width));
      m.remove();
    };
    measure();
    void document.fonts?.ready.then(measure);
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-room"] });
    return () => mo.disconnect();
  }, []);

  const p = prev.current;
  const roll = p !== null && p !== s && !reduced();
  const chars = [...s];
  const pc = p ? [...p] : [];
  useLayoutEffect(() => {
    prev.current = s;
    const box = el.current;
    if (!box || !roll) return;
    // the roll flag lives on the element, so a re-render mid-roll never cuts it short
    box.setAttribute("data-roll", "");
    const strips = box.querySelectorAll<HTMLElement>(".wl-strip");
    strips.forEach((x) => getComputedStyle(x).transform); // the old digit first
    strips.forEach((x) => x.style.setProperty("--v", x.dataset.to ?? "0"));
    const t = window.setTimeout(() => box.removeAttribute("data-roll"), tokenMs("--d-slow") + 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  return (
    <span className="wl-odo" ref={el} aria-hidden="true">
      {chars.map((c, k) => {
        const r = chars.length - 1 - k;
        const pk = pc.length - 1 - r;
        const digit = /\d/.test(c);
        const had = roll && pk >= 0 && /\d/.test(pc[pk]) === digit;
        const born = roll && !had ? "" : undefined;
        if (!digit)
          return (
            <span key={`c${r}`} className="wl-c" data-new={born} style={{ "--i": r } as React.CSSProperties}>
              {c}
            </span>
          );
        const from = had ? pc[pk] : c;
        return (
          <span key={`d${r}`} className="wl-d" data-new={born} style={{ "--i": r, width: w ? `${w[+c].toFixed(2)}px` : undefined } as React.CSSProperties}>
            <span className="wl-strip" data-to={c} style={{ "--v": roll ? from : c } as React.CSSProperties}>
              {STRIP}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/* ── the amount you type ─────────────────────────────────────────────────── */
const amtSize = (shown: string) => (shown.length <= 5 ? 60 : shown.length <= 7 ? 50 : shown.length <= 9 ? 42 : 36) + (phoneNow() ? 4 : 0);

/** Digits only, grouped as you type, sized to fit a line box that never moves. */
export function Amount({
  value,
  onChange,
  onEnter,
  buys,
  warn,
  bump,
  fieldRef,
}: {
  value: string;
  onChange: (digits: string) => void;
  onEnter: () => void;
  buys: React.ReactNode;
  warn?: boolean;
  bump: number;
  fieldRef?: React.Ref<HTMLLabelElement>;
}) {
  const shown = value ? fmt(+value) : "";
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const b = box.current;
    if (!bump || !b || reduced()) return;
    b.removeAttribute("data-bump");
    void b.offsetWidth;
    b.setAttribute("data-bump", "");
  }, [bump]);
  return (
    <div className="wl-amount" ref={box} style={{ "--amt-size": `${amtSize(shown)}px` } as React.CSSProperties}>
      <div className="wl-amt-line">
        <label className="wl-amt-field" data-v={shown || "0"} ref={fieldRef}>
          <input
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            aria-label="Amount in sats"
            placeholder="0"
            value={shown}
            maxLength={11}
            size={1}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && +value > 0) {
                e.preventDefault();
                onEnter();
              }
            }}
          />
        </label>
        <span className="wl-unit">sats</span>
      </div>
      <span className="wl-rule" aria-hidden="true" />
      <p className={warn ? "wl-buys warn" : "wl-buys"} aria-live="polite">
        {buys}
      </p>
    </div>
  );
}
/** The line under the number is always two set lines tall. */
export const Two = ({ a, b }: { a: React.ReactNode; b?: React.ReactNode }) => (
  <>
    <span className="l1">{a}</span>
    {b ? <span className="l2">{b}</span> : null}
  </>
);

export function Picks({ list, value, onPick }: { list: [number, string, string?][]; value: number; onPick: (n: number) => void }) {
  return (
    <div className="wl-picks" role="group" aria-label="Quick amounts">
      {list.map(([v, label, aria]) => (
        <button key={label} type="button" className="wl-pick" aria-pressed={value === v} aria-label={aria} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/* ── the switch: the chosen side lifts, the thumb glides ─────────────────── */
export function Seg({ label, a, b, i, done, onPick }: { label: string; a: string; b: string; i: 0 | 1; done?: boolean; onPick: (i: 0 | 1) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const n = (i === 0 ? 1 : 0) as 0 | 1;
    onPick(n);
    requestAnimationFrame(() => box.current?.querySelectorAll<HTMLElement>(".wl-seg-b")[n]?.focus());
  };
  return (
    <div className="wl-seg" role="tablist" aria-label={label} data-i={i} data-done={done ? "" : undefined} inert={done} ref={box} onKeyDown={key}>
      <span className="wl-seg-thumb" aria-hidden="true" />
      {[a, b].map((t, k) => (
        <button key={t} type="button" className="wl-seg-b" role="tab" aria-selected={i === k} tabIndex={i === k ? 0 : -1} onClick={() => onPick(k as 0 | 1)}>
          {t}
        </button>
      ))}
    </div>
  );
}

/* ── one pane shape: content from a fixed anchor, the action docked ──────── */
export function Pane({
  dir,
  fill,
  main,
  after,
  cls,
}: {
  dir?: "r" | "l" | "u" | "flip";
  fill: React.ReactNode;
  main: React.ReactNode;
  after?: React.ReactNode;
  cls?: string;
}) {
  return (
    <div className={`wl-pane${cls ? ` ${cls}` : ""}`} data-dir={dir} role="tabpanel">
      <div className="wl-fill">{fill}</div>
      <div className="wl-dock">
        <div className="wl-dock-main">{main}</div>
        <div className="wl-dock-after">{after}</div>
      </div>
    </div>
  );
}

export const Ring = () => (
  <span className="wl-ring">
    <svg viewBox="0 0 24 24" className="v2-ico" style={{ strokeWidth: 1.8 }} aria-hidden="true">
      <path d="m5.5 12.6 4 4 9-9.2" />
    </svg>
  </span>
);
export const Done = ({ title, line }: { title: string; line: string }) => (
  <div className="wl-done" role="status">
    <Ring />
    <p className="wl-done-t">{title}</p>
    <p className="wl-done-s">{line}</p>
  </div>
);
export const NumT = ({ n, numRef }: { n: number; numRef?: React.Ref<HTMLSpanElement> }) => (
  <p className="wl-inv-t">
    <span className="wl-inv-n" ref={numRef}>
      {fmt(n)}
    </span>
    <small>sats</small>
  </p>
);
export const Spin = () => <span className="spin sm" aria-hidden="true" />;
export const Warn = ({ size = 15 }: { size?: number }) => (
  <svg className="v2-ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4.6M12 15.6v.01" />
  </svg>
);
export const Info = () => (
  <svg className="v2-ico" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 11.2v4.8M12 8.2v.01" />
  </svg>
);
export const Clock = () => (
  <svg className="v2-ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.8V12l2.8 1.8" />
  </svg>
);
export const Share = () => (
  <svg className="v2-ico" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 14.5V4M8.2 7.6 12 3.8l3.8 3.8" />
    <path d="M8.5 10.5H7a2.5 2.5 0 0 0-2.5 2.5v4.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V13a2.5 2.5 0 0 0-2.5-2.5h-1.5" />
  </svg>
);

/** A note about what just happened: text, never a badge. */
export function Note({ kind, text, center }: { kind: "ok" | "info" | "warn"; text: React.ReactNode; center?: boolean }) {
  return (
    <p className={`wl-note${kind === "info" ? " info" : kind === "warn" ? " warn" : ""}${center ? " wl-center" : ""}`} role={kind === "warn" ? "alert" : "status"}>
      {kind === "warn" ? <Warn /> : kind === "info" ? <Info /> : <Icon name="check" size={15} />}
      <span>{text}</span>
    </p>
  );
}

/** Once something is pasted it is read back, not shown raw: one quiet line. */
export function Pasted({ text, label, onClear }: { text: string; label: string; onClear?: () => void }) {
  const short = text.length > 22 ? `${text.slice(0, 10)}…${text.slice(-8)}` : text;
  return (
    <div className="wl-pasted" role="group" aria-label={label}>
      <code title={text}>{short}</code>
      {onClear && (
        <button type="button" className="wl-clear" aria-label={`Clear the ${label.toLowerCase()}`} onClick={onClear}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/* ── a code on its plate: square modules, no dots, straight on --qr-bg ───── */
export function Code({ value, printed, copied, label, onCopy }: { value: string; printed: boolean; copied: boolean; label: string; onCopy: () => void }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(value || " ");
    q.make();
    const n = q.getModuleCount();
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
    return { n, d };
  }, [value]);
  return (
    <button type="button" className="wl-qr" aria-label={label} data-copied={copied ? "" : undefined} onClick={onCopy}>
      <svg className="wl-code" viewBox={`-0.5 -0.5 ${n + 1} ${n + 1}`} shapeRendering="crispEdges" aria-hidden="true">
        <path fill="currentColor" d={d} />
      </svg>
      {!printed && <span className="print" />}
      <span className="copied" aria-hidden="true">
        <Icon name="check" size={14} />
        Copied
      </span>
    </button>
  );
}

/** The copy line: the string you copy, cut to fit, with its glyph. */
export function CopyLine({ value, copied, label, onCopy }: { value: string; copied: boolean; label: string; onCopy: () => void }) {
  return (
    <button type="button" className="wl-lnstr" aria-label={label} onClick={onCopy}>
      <code>{value}</code>
      <span className="ic">
        <span className="swap" data-on={copied ? "" : undefined}>
          <Icon name="copy" size={15} />
          <Icon name="check" size={15} />
        </span>
      </span>
    </button>
  );
}

/** Copy, then say so for a moment. */
export function useCopy(say: (t: string) => void) {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      say("Copied");
    } catch {
      // the clipboard refused: nothing was copied, so nothing is claimed
    }
  };
  return { copied, copy };
}

/** FLIP: the element starts where (and as big as) the old one was. */
export function flipFrom(el: HTMLElement | null, from: DOMRect | null | undefined) {
  if (!el || !from || !from.width || reduced()) return;
  const to = el.getBoundingClientRect();
  if (!to.width) return;
  const k = from.width / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  el.animate([{ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${k.toFixed(3)})` }, { transform: "none" }], {
    duration: tokenMs("--d-slow"),
    easing: getComputedStyle(document.documentElement).getPropertyValue("--e-spring").trim() || "ease",
  });
}
