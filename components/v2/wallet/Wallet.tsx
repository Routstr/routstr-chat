"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useCashuStore, useTransactionHistoryStore } from "@/features/wallet";
import { useUnclaimedTokensStore } from "@/features/wallet/state/unclaimedTokensStore";
import { useInvoiceSync } from "@/hooks/useInvoiceSync";
import { useInvoiceChecker } from "@/hooks/useInvoiceChecker";
import { readSdkCachedBalance, useSdkCachedBalance } from "@/hooks/useSdkCachedBalance";
import { Icon } from "../icons";
import { useUi } from "../ui";
import { shortModelName } from "../format";
import { estimateSats, promptTokens } from "../price";
import { useMoney } from "../useMoney";
import { tokenMs } from "../motion";
import { Note, Odometer, dayOf, fmt, host, left, mintLabel, numSize, pairChange, phoneNow, reduced, span, toMs, whenIn } from "./bits";
import Add, { type Reopen } from "./Add";
import Send, { Tokens } from "./Send";

/* The back of the rail card: your money. The number first, what it buys, the
   two ways to move it, what is waiting, and what moved lately. Deeper views
   pan in from the right; Back and Escape step up one level. */

export type View = "home" | "add" | "send" | "tokens";
const ORDER: Record<View, number> = { home: 0, add: 1, send: 1, tokens: 2 };
const VIEWS: View[] = ["home", "add", "send", "tokens"];
const PLACE: Record<View, string> = { home: "Wallet", add: "Add funds", send: "Send", tokens: "Your tokens" };
const HOUR = 3_600_000;

/** What one ordinary reply costs with the chosen model. */
export function usePerReply() {
  const { selectedModel } = useChat();
  const per = estimateSats(selectedModel, promptTokens("", ""));
  return { per, name: shortModelName(selectedModel?.name, selectedModel?.id) };
}

/** Sats of a stored amount, whichever unit its mint keeps. */
export const satsOf = (n: number, unit?: string) => (unit === "msat" ? Math.floor(n / 1000) : n);

/** The active mint and what it holds (a token or a payment spends only from it). */
export function useActiveMint() {
  const cashu = useCashuStore();
  const { mintBalances, mintUnits } = useChat();
  const url = cashu.activeMintUrl ?? null;
  const all = cashu.mints.map((m) => ({ url: m.url, name: mintLabel(m), bal: satsOf(mintBalances?.[m.url] ?? 0, mintUnits?.[m.url]) }));
  const active = all.find((m) => m.url === url) ?? null;
  /** Another mint that could cover what the active one cannot. */
  const coverBy = (n: number) => all.find((m) => m.url !== url && m.bal >= n) ?? null;
  return { all, active, bal: active?.bal ?? 0, coverBy, set: cashu.setActiveMintUrlByUser };
}

export default function Wallet() {
  const ui = useUi();
  const [view, setView] = useState<View>("home");
  const [from, setFrom] = useState<"home" | "send">("home");
  const [first, setFirst] = useState(true);
  const [reopen, setReopen] = useState<Reopen | null>(null);
  const [lnPrefill, setLnPrefill] = useState<string | null>(null);
  const [freeze, setFreeze] = useState<number | null>(null);
  const [bloom, setBloom] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const sayEl = useRef<HTMLSpanElement>(null);
  const say = useCallback((t: string) => {
    const el = sayEl.current;
    if (!el) return;
    el.textContent = "";
    window.setTimeout(() => (el.textContent = t), 30);
  }, []);
  const money = useMoney();

  const up: View | "chats" = view === "tokens" ? from : view === "home" ? "chats" : "home";
  const go = useCallback(
    (v: View, opts: { reopen?: Reopen | null; ln?: string | null } = {}) => {
      setFirst(false);
      if (v === "tokens" && view !== "tokens") setFrom(view === "send" ? "send" : "home");
      if (opts.reopen !== undefined) setReopen(opts.reopen);
      if (opts.ln !== undefined) setLnPrefill(opts.ln);
      const deeper = ORDER[v] > ORDER[view];
      setView(v);
      if (v !== view) say(PLACE[v]);
      if (deeper && !phoneNow() && !reduced())
        window.setTimeout(() => root.current?.querySelector<HTMLElement>(`[data-v="${v}"] input, [data-v="${v}"] textarea`)?.focus({ preventScroll: true }), 120);
      if (!deeper && v !== view) window.setTimeout(() => root.current?.querySelector<HTMLElement>(".wl-back")?.focus({ preventScroll: true }), 0);
    },
    [view, say]
  );
  const back = () => (up === "chats" ? ui.setSide("chats") : go(up));

  // the card turned away: next time it opens at home
  useEffect(() => {
    if (ui.side === "wallet") return;
    const t = window.setTimeout(() => {
      setView("home");
      setReopen(null);
      setFirst(true);
    }, 600);
    return () => window.clearTimeout(t);
  }, [ui.side]);

  // Escape steps up one level; on home the rail turns the card back
  useEffect(() => {
    if (ui.side !== "wallet") return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || view === "home" || e.defaultPrevented) return;
      // a layer above the wallet takes its own Esc
      if (ui.palette || ui.picker || ui.settings) return;
      // the mint menu closes on its own Esc; the pane stays
      if ((e.target as Element | null)?.closest?.(".wl-menu")) return;
      e.preventDefault();
      e.stopPropagation();
      back();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  /* money landed while you were on Add: the card pans home, then the digits
     roll and the card light blooms once. Home holds its old number until then. */
  const landing = (before: number | null) => setFreeze(before);
  const land = useCallback(() => {
    go("home");
    window.setTimeout(() => {
      setFreeze(null);
      setBloom((b) => b + 1);
    }, reduced() ? 0 : 260);
  }, [go]);

  const pending = usePendingInvoices();
  const waiting = !money.node && pending.some((x) => !x.expired);

  return (
    <div className="wl" ref={root} data-first={first ? "" : undefined} data-waiting={waiting ? "" : undefined}>
      <header className="wl-head">
        <button type="button" className="wl-back" onClick={back} aria-label={up === "chats" ? "Back to chats" : up === "send" ? "Back to send" : "Back to wallet"}>
          {/* ← on a desktop, ‹ on a phone, as every Back there */}
          <Icon name="back" size={16} className="wl-bk-d" />
          <Icon name="left" size={16} className="wl-bk-m" />
          <span className="wl-swap" aria-hidden="true">
            <span data-off={up !== "chats" ? "" : undefined}>Chats</span>
            <span data-off={up !== "home" ? "" : undefined}>Wallet</span>
            <span data-off={up !== "send" ? "" : undefined}>Send</span>
          </span>
        </button>
        <span className="wl-where wl-swap">
          {VIEWS.map((v) => (
            <span key={v} data-off={v !== view ? "" : undefined} aria-hidden={v !== view || undefined}>
              {PLACE[v]}
            </span>
          ))}
        </span>
        <span className="sr" aria-live="polite" ref={sayEl} />
      </header>
      <div className="wl-stage">
        {VIEWS.map((v) => (
          <section
            key={v}
            className="wl-view scroll"
            data-v={v}
            aria-label={v === "tokens" ? "Tokens not claimed yet" : PLACE[v]}
            data-pos={v === view ? "here" : ORDER[v] < ORDER[view] || (v === "home" && view !== "home") ? "left" : "right"}
            inert={v !== view}
          >
            {v === "home" ? (
              <Home go={go} freeze={freeze} bloom={bloom} />
            ) : v === "add" ? (
              <Add reopen={reopen} clearReopen={() => setReopen(null)} say={say} landing={landing} land={land} toPay={(inv) => go("send", { ln: inv })} />
            ) : v === "send" ? (
              <Send say={say} toTokens={() => go("tokens")} toAdd={() => go("add")} prefill={lnPrefill} clearPrefill={() => setLnPrefill(null)} />
            ) : (
              <Tokens say={say} onEmptyBack={() => root.current?.querySelector<HTMLElement>(".wl-back")?.focus({ preventScroll: true })} />
            )}
          </section>
        ))}
      </div>
      <MintFoot />
    </div>
  );
}

/* ── what waits: invoices not paid yet ───────────────────────────────────── */
export function usePendingInvoices() {
  const history = useTransactionHistoryStore();
  const { invoices } = useInvoiceSync();
  return useMemo(() => {
    const byQuote = new Map(invoices.map((i) => [i.quoteId, i]));
    return history.pendingTransactions
      .filter((p) => p.direction === "in")
      .map((p) => {
        const t = toMs(p.timestamp);
        // a quote with no deadline is treated as good for an hour, as the sync does
        const exp = byQuote.get(p.quoteId)?.expiresAt ?? t + HOUR;
        return { ...p, amount: Number(p.amount) || 0, t, exp, expired: Date.now() > exp };
      })
      // an expired one says so for a while, then leaves the list (only the
      // list: the record stays, so a payment that raced the deadline still lands)
      .filter((x) => !x.expired || Date.now() - x.exp < 10 * 60_000)
      .sort((a, b) => b.t - a.t);
  }, [history.pendingTransactions, invoices]);
}

/* ── paid invoices whose ecash never came in ─────────────────────────────── */
/* The same test and the same claim the invoice history uses (useInvoiceChecker's retryInvoice):
   a paid mint quote, or one whose claim is marked for recovery */
function usePaidUnclaimed() {
  const { invoices } = useInvoiceSync();
  const { retryInvoice } = useInvoiceChecker();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const list = useMemo(
    () =>
      invoices
        .filter(
          (i) =>
            i.type === "mint" &&
            ((i.state as string) === "PAID" || i.claimError === "recovery_pending" || i.claimError === "missing_preview")
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [invoices]
  );
  const receive = async (inv: (typeof list)[number]) => {
    setBusy(inv.id);
    setFailed(null);
    try {
      const ok = await retryInvoice(inv);
      if (!ok) setFailed(inv.id);
    } catch {
      setFailed(inv.id);
    } finally {
      setBusy(null);
    }
  };
  return { list, busy, failed, receive };
}

/* ── home ────────────────────────────────────────────────────────────────── */
function Home({ go, freeze, bloom }: { go: (v: View, o?: { reopen?: Reopen | null }) => void; freeze: number | null; bloom: number }) {
  const money = useMoney();
  const { refundAllApiKeys } = useChat();
  const held = useSdkCachedBalance();
  const history = useTransactionHistoryStore();
  const tokens = useUnclaimedTokensStore((s) => s.unclaimedTokens);
  const invoices = usePendingInvoices();
  const paid = usePaidUnclaimed();
  const { per, name } = usePerReply();
  const hero = useRef<HTMLDivElement>(null);

  // the card light blooms once when money lands
  const lastTotal = useRef(money.total);
  const settled = useRef(false);
  useEffect(() => {
    if (money.loading) return;
    const t = window.setTimeout(() => (settled.current = true), 1500);
    return () => window.clearTimeout(t);
  }, [money.loading]);
  const [bloomK, setBloomK] = useState(0);
  useEffect(() => {
    const d = money.total - lastTotal.current;
    lastTotal.current = money.total;
    if (d >= 1 && settled.current && freeze === null) setBloomK((k) => k + 1);
  }, [money.total, freeze]);
  useEffect(() => {
    const h = hero.current;
    if ((!bloom && !bloomK) || !h || reduced()) return;
    h.removeAttribute("data-bloom");
    void h.offsetWidth;
    h.setAttribute("data-bloom", "");
  }, [bloom, bloomK]);

  // a row that arrived opens in place with a wash of light
  const [fresh, setFresh] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = history.history.map((h) => h.id);
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const n = history.history.find((h) => !seen.current!.has(h.id) && h.direction === "in");
    ids.forEach((id) => seen.current!.add(id));
    if (n) setFresh(n.id);
  }, [history.history]);

  // held with providers: named, counted, one tap from coming home
  const [heldState, setHeldState] = useState<"idle" | "busy" | "done" | "part">("idle");
  const [heldBack, setHeldBack] = useState(0);
  // the store can drop returned tokens a moment after the call resolves, so the count of
  // successful returns also says whether anything came back
  const [someBack, setSomeBack] = useState(false);
  // the note says what moved, measured: held before the call less held after
  // (the call resolves once the store has re-read what the providers hold)
  const giveBack = async () => {
    const before = readSdkCachedBalance();
    setHeldState("busy");
    try {
      const r = await refundAllApiKeys();
      const moved = Math.max(0, before - readSdkCachedBalance());
      setHeldBack(moved);
      setSomeBack(r.totalRefunded > 0);
      setHeldState((moved > 0 || r.totalRefunded > 0) && r.totalFailed === 0 ? "done" : "part");
    } catch {
      setHeldState("part");
    }
  };
  useEffect(() => {
    if (heldState !== "done") return;
    const t = window.setTimeout(() => setHeldState("idle"), 5000);
    return () => window.clearTimeout(t);
  }, [heldState]);

  // activity: one line per movement, by day; three spends in a row fold
  const [all, setAll] = useState(false);
  const [runs, setRuns] = useState<Set<string>>(new Set());
  // a reply is one line, what it really cost: its payment less the change that came back
  const items = useMemo(() => {
    const { sorted, changeOf, taken } = pairChange(history.history);
    return sorted
      .filter((h) => !taken.has(h.id))
      .map((h) => {
        const c = changeOf.get(h.id);
        return { id: c ? `${h.id}-${c.id}` : h.id, dir: h.direction, amount: (Number(h.amount) || 0) - (c ? Number(c.amount) || 0 : 0), t: toMs(h.timestamp) };
      })
      // a reply that was refunded in full cost nothing and needs no line
      .filter((h) => h.amount > 0)
      .sort((a, b) => b.t - a.t);
  }, [history.history]);

  if (money.loading && !money.node) {
    return (
      <>
        <div className="wl-hero">
          <span className="wl-ghost num" />
          <span className="wl-ghost sub" />
        </div>
        <div className="wl-acts">
          <button type="button" className="wl-act main" disabled>
            <Icon name="arrowDown" size={16} />
            <span>Add</span>
          </button>
          <button type="button" className="wl-act up" disabled>
            <Icon name="arrowUp" size={16} />
            <span>Send</span>
          </button>
        </div>
        <div className="wl-sec">
          <p className="wl-sec-t">Activity</p>
          {[82, 64, 74].map((w, i) => (
            <div key={i} className="wl-row" aria-hidden="true">
              <span className="wl-ghost row" style={{ width: `${w}%`, animationDelay: `${i * 0.15}s` }} />
            </div>
          ))}
        </div>
        <p className="sr" role="status">
          Reading your balance
        </p>
      </>
    );
  }

  const T = freeze ?? money.total;
  const zero = T <= 0;
  const replies = per > 0 ? Math.floor(T / per) : 0;
  const tokSum = tokens.reduce((s, t) => s + satsOf(t.amount, t.unit), 0);
  const list = all ? items : items.slice(0, 40);
  const groups: { g: string; items: typeof items }[] = [];
  for (const h of list) {
    const g = dayOf(h.t);
    if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, items: [] });
    groups[groups.length - 1].items.push(h);
  }
  const line = (h: (typeof items)[number], quiet?: boolean) => {
    const row = (
      <div key={h.id} className={`wl-line${quiet ? " sub" : ""}${h.dir === "in" ? " in" : ""}`}>
        <span className="wl-line-t">{quiet ? "" : h.dir === "in" ? "Received" : "Spent"}</span>
        <span className="wl-line-w">{whenIn(h.t)}</span>
        <span className={`wl-amt${h.dir === "in" ? " in" : ""}`}>
          {h.dir === "in" ? "+" : "−"}
          {fmt(h.amount)}
        </span>
      </div>
    );
    return h.id === fresh ? (
      <div key={h.id} className="wl-enter">
        <div>{row}</div>
      </div>
    ) : (
      row
    );
  };
  const day = (rows: typeof items) => {
    const out: React.ReactNode[] = [];
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j < rows.length && rows[j].dir === "out" && rows[j].id !== fresh) j++;
      if (j - i >= 3) {
        const run = rows.slice(i, j);
        const key = run[0].id;
        const open = runs.has(key);
        out.push(
          <div key={key} className="wl-run" data-open={open ? "" : undefined}>
            <button
              type="button"
              className="wl-line"
              aria-expanded={open}
              onClick={() => setRuns((s) => (s.has(key) ? new Set([...s].filter((x) => x !== key)) : new Set(s).add(key)))}
            >
              <span className="wl-line-t">
                Spent {run.length} times
                <Icon name="down" size={13} className="wl-chev" />
              </span>
              <span className="wl-line-w">{span(run[run.length - 1].t, run[0].t)}</span>
              <span className="wl-amt">
                {"−"}
                {fmt(run.reduce((a, h) => a + h.amount, 0))}
              </span>
            </button>
            <div className="wl-run-body">
              <div inert={!open}>{run.map((h) => line(h, true))}</div>
            </div>
          </div>
        );
        i = j;
      } else {
        for (let k = i; k < Math.max(j, i + 1); k++) out.push(line(rows[k]));
        i = Math.max(j, i + 1);
      }
    }
    return out;
  };

  return (
    <>
      {money.node ? (
        <>
          <div className="wl-hero" ref={hero}>
            <p className="wl-node-t">Your node pays</p>
            <p className="wl-node-h">
              <span className="wl-live" style={{ animation: "none" }} />
              <span>{host(money.node.url)}</span>
            </p>
            <p className="wl-sub">Replies are paid by your node. The sats on this device stay here until you use them.</p>
          </div>
          <div className="wl-row" style={{ marginBottom: "var(--s3)" }}>
            <span className="wl-row-t">
              <span>On this device</span>
            </span>
            <span className="wl-row-r">
              <span className="wl-amt">{fmt(money.wallet)} sats</span>
            </span>
          </div>
        </>
      ) : (
        <div className="wl-hero" ref={hero}>
          <p className="wl-num" data-zero={zero ? "" : undefined} style={{ "--num-size": `${numSize(fmt(T))}px` } as React.CSSProperties}>
            <Odometer value={T} />
            <span className="wl-unit" aria-hidden="true">
              sats
            </span>
            <span className="sr">{fmt(T)} sats</span>
          </p>
          <p className="wl-sub">
            {zero ? (
              <>
                <span className="l1">Add sats to start chatting</span>
                {per > 0 && (
                  <>
                    About {fmt(Math.max(1, Math.round(per)))} sats a <span className="wl-ph">{name} </span>reply
                  </>
                )}
              </>
            ) : per > 0 ? (
              <>
                <span className="l1">
                  About {fmt(replies)} {replies === 1 ? "reply" : "replies"}
                </span>
                with {name}
              </>
            ) : null}
          </p>
        </div>
      )}
      <div className="wl-acts">
        <button type="button" className="wl-act main" onClick={() => go("add", { reopen: null })}>
          <Icon name="arrowDown" size={16} />
          <span>Add</span>
        </button>
        <button type="button" className="wl-act up" disabled={money.wallet <= 0} aria-describedby={money.wallet <= 0 ? "wlNoSend" : undefined} onClick={() => go("send")}>
          <Icon name="arrowUp" size={16} />
          <span>Send</span>
        </button>
        {money.wallet <= 0 && (
          <span className="sr" id="wlNoSend">
            Nothing to send yet
          </span>
        )}
      </div>

      {(invoices.length > 0 || tokens.length > 0 || paid.list.length > 0) && (
        <div className="wl-sec">
          <p className="wl-sec-t">
            <span>Waiting</span>
          </p>
          <div className="wl-rows">
            {/* paid, but the ecash never came in (the mint refused the claim once): the invoice
                history's own recovery takes it, one press, nothing else moves */}
            {paid.list.map((x) => (
              <div className="wl-row wl-held" key={x.id}>
                <span className="wl-row-t">
                  <span>Invoice for {fmt(x.amount)} sats</span>
                </span>
                <span className="wl-row-s">
                  {x.claimError === "missing_preview"
                    ? "Paid, but it needs a manual recovery."
                    : paid.failed === x.id
                      ? "Paid. The mint did not hand it over yet. Try again."
                      : "Paid, not received yet."}
                </span>
                <span className="wl-row-r">
                  {x.claimError === "missing_preview" ? null : paid.busy === x.id ? (
                    <span className="wl-link" data-busy="" aria-disabled="true">
                      <span className="spin sm" role="status" aria-label="Receiving" />
                      Receiving
                    </span>
                  ) : (
                    <button type="button" className="wl-link" aria-label={`Receive the ${fmt(x.amount)} sats from this paid invoice`} disabled={!!paid.busy} onClick={() => void paid.receive(x)}>
                      Receive
                    </button>
                  )}
                </span>
              </div>
            ))}
            {invoices.map((x) => (
              <button type="button" key={x.id} className="wl-row" onClick={() => go("add", { reopen: { id: x.id, quoteId: x.quoteId, amount: x.amount, pr: x.paymentRequest, exp: x.exp, mintUrl: x.mintUrl } })}>
                <span className="wl-row-t">
                  {!x.expired && <span className="wl-live" />}
                  <span>Invoice for {fmt(x.amount)} sats</span>
                </span>
                <span className="wl-row-s">{x.expired ? "Expired. Nothing was paid." : `Not paid yet. Good for ${left(x.exp)}.`}</span>
                <span className="wl-row-r">
                  <Icon name="right" size={14} className="wl-chev" />
                </span>
              </button>
            ))}
            {tokens.length > 0 && (
              <button type="button" className="wl-row" onClick={() => go("tokens")}>
                <span className="wl-row-t">
                  <span>{tokens.length === 1 ? "1 token" : `${tokens.length} tokens`} not claimed yet</span>
                </span>
                <span className="wl-row-s">{fmt(tokSum)} sats you can still take back</span>
                <span className="wl-row-r">
                  <Icon name="right" size={14} className="wl-chev" />
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {heldState === "done" ? (
        <div className="wl-grow">
          <div>
            <div className="wl-sec">
              <Note kind="ok" text={`${fmt(heldBack)} sats are back in your wallet.`} />
            </div>
          </div>
        </div>
      ) : held > 0 ? (
        <div className="wl-sec">
          <p className="wl-sec-t">
            <span>With providers</span>
          </p>
          <div className="wl-row wl-held">
            <span className="wl-row-t">
              <span>{fmt(held)} sats</span>
            </span>
            <span className="wl-row-r">
              {heldState === "busy" ? (
                <span className="wl-link" data-busy="" aria-disabled="true">
                  <span className="spin sm" role="status" aria-label="Returning" />
                  Returning
                </span>
              ) : (
                <button type="button" className="wl-link" aria-label={`Return ${fmt(held)} sats to the wallet`} onClick={() => void giveBack()}>
                  Return
                </button>
              )}
            </span>
            <span className="wl-row-s">
              {heldState === "busy"
                ? "On their way back to your wallet. Your balance stays the same."
                : heldState === "part"
                  ? heldBack > 0
                    ? `${fmt(heldBack)} sats came back. The rest could not yet. Try again later.`
                    : someBack
                      ? "Some came back. The rest could not yet. Try again later."
                      : "Nothing came back yet. Try again later."
                  : "Not in your balance yet. It comes back on its own when the providers answer."}
            </span>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="wl-sec">
          <p className="wl-sec-t">Activity</p>
          <p className="wl-empty">Nothing yet. Money in and out shows here.</p>
        </div>
      ) : (
        <div className="wl-sec" aria-label="Activity">
          {groups.map((g) => (
            <div className="wl-grp" key={g.g}>
              <p className="wl-grp-t">{g.g}</p>
              <div className="wl-rows">{day(g.items)}</div>
            </div>
          ))}
          {items.length > 40 && !all && (
            <button type="button" className="wl-textlink wl-more" onClick={() => setAll(true)}>
              Show {fmt(items.length - 40)} earlier
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ── the foot: which mint holds your sats ────────────────────────────────── */
function MintFoot() {
  const ui = useUi();
  const m = useActiveMint();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (focus: boolean) => {
    if (!open) return;
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, reduced() ? 0 : phoneNow() ? tokenMs("--d-mid") : tokenMs("--d-fast"));
    if (focus) btn.current?.focus({ preventScroll: true });
  };
  // the palette opening over it closes it: nothing stays open behind the veil to take its Esc
  useEffect(() => {
    if (ui.palette) close(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.palette]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"], .wl-mi')?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>(".wl-mi") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <footer className="wl-foot">
      <button
        type="button"
        ref={btn}
        className="wl-mint"
        aria-haspopup="menu"
        aria-expanded={open && !closing}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="bal-k">Mint</span>
        <span className="wl-mint-v">{m.active ? m.active.name : <span style={{ color: "var(--ink-3)" }}>None yet</span>}</span>
        <Icon name="down" size={15} />
      </button>
      {open && (
        <>
          <div className="wl-scrim" data-closing={closing ? "" : undefined} onClick={() => close(true)} />
          <div className="wl-menu" role="menu" aria-label="Mints" ref={menu} data-closing={closing ? "" : undefined} onKeyDown={onKey}>
            {m.all.length ? null : (
              <p className="wl-menu-h" style={{ paddingTop: 2 }}>
                No mints yet. One is picked for you when you first add funds.
              </p>
            )}
            {m.all.map((x) => (
              <button
                key={x.url}
                type="button"
                className="wl-mi"
                role="menuitemradio"
                aria-checked={x.url === m.active?.url}
                onClick={() => {
                  m.set(x.url);
                  close(true);
                }}
              >
                {x.url === m.active?.url ? <Icon name="check" size={15} /> : <span />}
                <span className="wl-mi-n">{x.name}</span>
                {x.name !== host(x.url) && <span className="wl-mi-h">{host(x.url)}</span>}
                <span className="wl-amt">{fmt(x.bal)}</span>
              </button>
            ))}
            <div className="wl-menu-sep" />
            <button
              type="button"
              className="wl-mi manage"
              role="menuitem"
              onClick={() => {
                close(false);
                ui.openSettings("wallet");
              }}
            >
              <Icon name="gear" size={15} />
              <span>Manage mints</span>
            </button>
          </div>
        </>
      )}
    </footer>
  );
}
