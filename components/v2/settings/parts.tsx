"use client";

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../icons";
import { tokenMs } from "../motion";

/* The one vocabulary every settings page is drawn in: a group with its name
   in the left margin, rows (title, one plain line, a control), list items,
   folds that open in place, switches, segmented choices, and confirms that
   put the safe choice first and the risky one last. */

export const n0 = (n: number) => Math.max(0, Math.round(n)).toLocaleString("en-US");
export const plural = (n: number, one: string, many?: string) => `${n0(n)} ${n === 1 ? one : many ?? `${one}s`}`;
export const hostOf = (u: string) => u.replace(/^(https?|wss?):\/\//, "").replace(/\/$/, "");
export const short = (k: string, a = 10, b = 6) => (k.length > a + b + 1 ? `${k.slice(0, a)}…${k.slice(-b)}` : k);
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 419px)").matches;
// put back where it was
export const at = (list: string[], u: string, i: number) => (list.includes(u) ? list : [...list.slice(0, i), u, ...list.slice(i)]);

/* ── the page head: a title and a lede that breaks only between sentences ── */
export function Head({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="st-head">
      <h2 className="st-t" id="st-title" tabIndex={-1}>
        {title}
      </h2>
      {lede && (
        <p className="st-lede">
          {lede.split(/(?<=\.)\s+(?=[A-Z])/).map((x, i) => (
            <React.Fragment key={i}>
              {i > 0 && " "}
              <span className="st-s">{x}</span>
            </React.Fragment>
          ))}
        </p>
      )}
    </header>
  );
}

/* ── a group: its name in the margin, a status under it when it says something ── */
export function Grp({ id, k, kv, tone, children }: { id: string; k: string; kv?: React.ReactNode; tone?: "ok" | "warn"; children: React.ReactNode }) {
  return (
    <section className="st-grp" id={id} aria-labelledby={`${id}-k`}>
      <div className="st-marg">
        <h3 className="st-k" id={`${id}-k`}>
          {k}
        </h3>
        <span className="st-kv" data-tone={tone}>
          {kv}
        </span>
      </div>
      <div className="st-body">{children}</div>
    </section>
  );
}

export function Row({
  id,
  title,
  note,
  children,
  wrap,
  top,
}: {
  id?: string;
  title: React.ReactNode;
  note?: React.ReactNode;
  children?: React.ReactNode;
  wrap?: boolean;
  top?: boolean;
}) {
  // a row that holds one switch is the switch: tapping its words flips it
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, select, textarea, label")) return;
    const sws = e.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > .st-ctl > .st-sw");
    if (sws.length === 1 && !sws[0].disabled) sws[0].click();
  };
  return (
    <div className={`st-row${wrap ? " wrap" : ""}${top ? " top" : ""}`} id={id} onClick={onClick}>
      <div className="st-txt">
        <p className="st-rt">{title}</p>
        {note && <p className="st-rn">{note}</p>}
      </div>
      {children && <div className="st-ctl">{children}</div>}
    </div>
  );
}

export function Sw({ on, label, onChange, disabled, controls }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean; controls?: string }) {
  return (
    <button type="button" className="st-sw" role="switch" aria-checked={on} aria-label={label} aria-controls={controls} disabled={disabled} onClick={() => onChange(!on)} />
  );
}

export function Btn({
  children,
  icon,
  kind,
  onClick,
  disabled,
  busy,
  done,
  controls,
  open,
  label,
  className,
}: {
  children: React.ReactNode;
  icon?: IconName;
  kind?: "prime" | "warn" | "bare";
  onClick?: () => void;
  disabled?: boolean;
  /** a verb for the wait, shown beside a spinner */
  busy?: string | false;
  done?: boolean;
  controls?: string;
  open?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`st-btn${kind ? ` ${kind}` : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      data-busy={busy ? "" : undefined}
      data-done={done ? "" : undefined}
      aria-controls={controls}
      aria-expanded={controls ? !!open : undefined}
      aria-label={label}
      aria-busy={busy ? true : undefined}
    >
      {busy ? (
        <>
          <span className="st-spin" aria-hidden="true" />
          <span>{busy}</span>
        </>
      ) : (
        <>
          {icon && <Icon name={done ? "check" : icon} size={15} />}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}

export function Ib({ icon, label, onClick, disabled, hov, controls, open, warn }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; hov?: boolean; controls?: string; open?: boolean; warn?: boolean }) {
  return (
    <button
      type="button"
      className={`st-ib${hov ? " st-hov" : ""}${warn ? " warn" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      aria-controls={controls}
      aria-expanded={controls ? !!open : undefined}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/** Opens in place: rows grow, the contents fade in a beat later. */
export function Fold({ id, open, children }: { id: string; open: boolean; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const was = useRef(open);
  useEffect(() => {
    if (!open || was.current) {
      was.current = open;
      return;
    }
    was.current = true;
    const t = window.setTimeout(() => {
      el.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
      el.current?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
    }, tokenMs("--d-move"));
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <div className="st-fold" id={id} data-open={open ? "" : undefined} ref={el}>
      <div className="st-fold-in" inert={!open}>
        {children}
      </div>
    </div>
  );
}

/** A question that asks first: the safe choice, any helper, then the risky one. */
export function Say({ children, acts, inset, warn }: { children: React.ReactNode; acts: React.ReactNode; inset?: "l" | "r"; warn?: boolean }) {
  return (
    <div className={`st-say${warn ? " warn" : ""}${inset === "l" ? " st-inset" : inset === "r" ? " st-inset r" : ""}`}>
      {children}
      <div className="st-acts">{acts}</div>
    </div>
  );
}

/** A segmented choice: a thumb glides under the chosen one; arrows move it. */
export function Seg<T extends string>({ label, opts, value, onChange, tabs, wide }: { label: string; opts: [T, string][]; value: T; onChange: (v: T) => void; tabs?: boolean; wide?: boolean }) {
  const i = Math.max(0, opts.findIndex(([v]) => v === value));
  const box = useRef<HTMLDivElement>(null);
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + opts.length) % opts.length;
    onChange(opts[j][0]);
    requestAnimationFrame(() => box.current?.querySelectorAll<HTMLElement>("button")[j]?.focus());
  };
  return (
    <div
      ref={box}
      className={`st-seg${wide ? " wide" : ""}`}
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={label}
      style={{ "--n": opts.length, "--i": i } as React.CSSProperties}
      onKeyDown={key}
    >
      <span className="st-seg-t" aria-hidden="true" />
      {opts.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role={tabs ? "tab" : "radio"}
          aria-selected={tabs ? v === value : undefined}
          aria-checked={tabs ? undefined : v === value}
          tabIndex={v === value ? 0 : -1}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/* ── the value roll (the signature): a changed value slides up and settles ── */
export function Roll({ text, className = "st-v" }: { text: string; className?: string }) {
  const [items, setItems] = useState([{ k: 0, t: text, s: "" as "" | "in" | "out" | "lit" }]);
  const n = useRef(0);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (items[items.length - 1]?.t === text) return;
    if (reducedMotion()) return setItems([{ k: ++n.current, t: text, s: "" }]);
    const k = ++n.current;
    setItems((xs) => [...xs.filter((x) => x.s !== "out").map((x) => ({ ...x, s: "out" as const })), { k, t: text, s: "in" as const }]);
    // only the inner frame can outlive a newer value (cancel stops the outer one), so it lights the
    // new one only while it is still arriving, never one already leaving
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setItems((xs) => xs.map((x) => (x.k === k && x.s === "in" ? { ...x, s: "lit" } : x)))));
    const t1 = window.setTimeout(() => setItems((xs) => xs.filter((x) => x.s !== "out")), tokenMs("--d-mid") + 40);
    const t2 = window.setTimeout(() => setItems((xs) => xs.map((x) => (x.k === k ? { ...x, s: "" } : x))), tokenMs("--d-move") * 2);
    return () => {
      cancelAnimationFrame(r);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <span className={className} aria-live="off">
      {items.map((x) => (
        <i key={x.k} className={x.s || undefined} aria-hidden={x.s === "out" || undefined}>
          {x.t}
        </i>
      ))}
    </span>
  );
}

/* ── a toast: inside the panel, bottom centre, with an optional Undo ──────── */
type Toast = { text: string; undo?: () => void; k: number };
const ToastCtx = createContext<(text: string, undo?: () => void) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ pane, children }: { pane: React.RefObject<HTMLElement | null>; children: React.ReactNode }) {
  const [t, setT] = useState<Toast | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  const show = useCallback((text: string, undo?: () => void) => {
    window.clearTimeout(timer.current);
    setLeaving(false);
    setT({ text, undo, k: Date.now() });
    timer.current = window.setTimeout(() => {
      setLeaving(true);
      timer.current = window.setTimeout(() => setT(null), tokenMs("--d-mid"));
    }, 5000);
  }, []);
  useEffect(() => {
    pane.current?.toggleAttribute("data-toast", !!t && !leaving);
  }, [t, leaving, pane]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className="st-toast" role="status" data-leaving={leaving ? "" : undefined} key={t.k}>
          <span>{t.text}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => {
                t.undo?.();
                window.clearTimeout(timer.current);
                setT(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/** Copy, then show the button done for a moment. */
export function useCopied() {
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(null), 1600);
    return () => window.clearTimeout(t);
  }, [done]);
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(key);
      return true;
    } catch {
      return false;
    }
  };
  return { done, copy };
}

/* ── removed, with the way back in its own row ─────────────────────────────
   A removed item keeps its place for five seconds as "Removed <what> · Undo",
   with the rail's unwinding ring, then leaves. No toast carries an undo. */
const GONE_MS = 5000;
type Gone = { label: string; index: number; undo: () => void };
export function useGone() {
  const [gone, setGone] = useState<Map<string, Gone>>(new Map());
  const timers = useRef(new Map<string, number>());
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const forget = useCallback((key: string) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setGone((m) => {
      const n = new Map(m);
      n.delete(key);
      return n;
    });
  }, []);
  /** Mark `key` (at its old `index`) removed; `undo` puts it back. */
  const drop = useCallback(
    (key: string, label: string, index: number, undo: () => void) => {
      window.clearTimeout(timers.current.get(key));
      timers.current.set(key, window.setTimeout(() => forget(key), GONE_MS));
      setGone((m) => new Map(m).set(key, { label, index, undo }));
    },
    [forget]
  );
  const restore = (key: string) => {
    gone.get(key)?.undo();
    forget(key);
  };
  /** The list with its removed items back at their places. */
  const merge = <T,>(items: T[], keyOf: (x: T) => string): ({ item: T; gone?: undefined; key: string } | { item?: undefined; gone: Gone; key: string })[] => {
    const out: ({ item: T; gone?: undefined; key: string } | { item?: undefined; gone: Gone; key: string })[] = items.map((item) => ({ item, key: keyOf(item) }));
    [...gone.entries()]
      .filter(([k]) => !items.some((x) => keyOf(x) === k))
      .sort((a, b) => a[1].index - b[1].index)
      .forEach(([key, g]) => out.splice(Math.min(g.index, out.length), 0, { gone: g, key }));
    return out;
  };
  return { gone, drop, restore, merge };
}

export function GoneRow({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <div className="st-it st-gone" role="status">
      <span className="st-it-t">Removed {label}</span>
      <button type="button" className="st-undo" onClick={onUndo}>
        Undo
        <svg className="st-ring" viewBox="0 0 16 16" aria-hidden="true" style={{ animationDuration: `${GONE_MS}ms` }}>
          <circle className="st-ring-bg" cx="8" cy="8" r="6" />
          <circle className="st-drain" cx="8" cy="8" r="6" pathLength={100} style={{ animationDuration: `${GONE_MS}ms` }} />
        </svg>
      </button>
    </div>
  );
}
