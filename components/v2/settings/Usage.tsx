"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useChatSync } from "@/hooks/useChatSync";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/components/ClientProviders";
import { useSdkUsageHistory } from "@/features/wallet/hooks/useSdkUsageHistory";
import { useTransactionHistoryStore } from "@/features/wallet/state/transactionHistoryStore";
import { getPendingCashuTokenAmount, getPendingCashuTokenDistribution } from "@/utils/cashuUtils";
import { getLocalCashuTokens } from "@/utils/storageUtils";
import { renderCompanyIcon } from "@/components/chat/model-selector/display";
import { getModelCompanyId } from "@/components/chat/modelCompanies";
import { Icon } from "../icons";
import { satUnit, sats, shortModelName } from "../format";
import { tokenMs } from "../motion";
import { Btn, Fold, Grp, Roll, Say, Seg, Sw, hostOf, n0, plural, useCopied, useToast } from "./parts";
import { pairChange } from "../wallet/bits";

/* Every request and every payment, kept only in this browser. The period's
   three numbers read at a glance; hover, focus or tap a bar and they roll to
   that bar. Clearing sits together at the end, each asking first. */

type Period = "1d" | "7d" | "30d" | "all";
const PERIOD_LBL: Record<Period, string> = { "1d": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };
const H = 3_600_000;
const D = 24 * H;
const fmtTok = (t: number) => {
  const cut = (x: number, d: number) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace(/\.0+$/, "");
  return t >= 1e6 ? `${cut(t / 1e6, t >= 1e7 ? 1 : 2)}M` : t >= 1e3 ? `${cut(t / 1e3, t >= 1e4 ? 0 : 1)}k` : n0(t);
};
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 419px)").matches;
const when = (t: number) => {
  const d = new Date(t);
  const today = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (t >= today) return hm;
  if (t >= today - D) return `Yesterday ${hm}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** The buckets a period is drawn in, oldest first, each with its start time. */
function buckets(period: Period, oldest: number) {
  const now = new Date();
  if (period === "1d") {
    const top = new Date(now);
    top.setMinutes(0, 0, 0);
    return Array.from({ length: 24 }, (_, i) => top.getTime() - (23 - i) * H);
  }
  if (period === "7d" || period === "30d") {
    const n = period === "7d" ? 7 : 30;
    const day = new Date(now.setHours(0, 0, 0, 0)).getTime();
    return Array.from({ length: n }, (_, i) => day - (n - 1 - i) * D);
  }
  const first = new Date(oldest || Date.now());
  const months: number[] = [];
  const m = new Date(first.getFullYear(), first.getMonth(), 1);
  const end = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  while (m.getTime() <= end) {
    months.push(m.getTime());
    m.setMonth(m.getMonth() + 1);
  }
  return months.slice(-12);
}
function phrase(period: Period, start: number, last: boolean, short: boolean) {
  const d = new Date(start);
  const hh = (x: number) => `${String(x).padStart(2, "0")}:00`;
  if (period === "1d") return last ? "this hour" : short ? `at ${hh(d.getHours())}` : `${hh(d.getHours())} to ${hh((d.getHours() + 1) % 24)}`;
  if (period === "all") return last ? "this month" : `in ${d.toLocaleString("en-GB", { month: short ? "short" : "long" })}`;
  const back = Math.round((new Date().setHours(0, 0, 0, 0) - start) / D);
  if (back === 0) return "today";
  if (back === 1) return "yesterday";
  return period === "7d" ? `on ${d.toLocaleString("en-GB", { weekday: short ? "short" : "long" })}` : `on ${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })}`;
}
function tick(period: Period, start: number, i: number, n: number) {
  const d = new Date(start);
  if (i === n - 1) return period === "1d" ? "now" : period === "all" ? d.toLocaleString("en-US", { month: "short" }) : "Today";
  if (period === "1d") return i % 6 === 0 ? String(d.getHours()).padStart(2, "0") : "";
  if (period === "7d") return d.toLocaleString("en-US", { weekday: "short" });
  if (period === "30d") return i % 10 === 0 ? `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })}` : "";
  return i % 3 === 0 ? d.toLocaleString("en-US", { month: "short" }) : "";
}

const PAGE = 15;
/** A paged list keeps a full page's height on a shorter last page, so the pager under it stays put. */
function useFullPageHeight(paged: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const full = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.minHeight = "";
    full.current = paged ? Math.max(full.current, el.offsetHeight) : 0;
    if (full.current) el.style.minHeight = `${full.current}px`;
  });
  return ref;
}
/** A long list a page at a time, newest first: where you are, and a step either way. */
function Pager({ n, page, onPage }: { n: number; page: number; onPage: (p: number) => void }) {
  if (n <= PAGE) return null;
  const last = Math.ceil(n / PAGE) - 1;
  return (
    <div className="st-tfoot st-pager">
      <span>
        {n0(page * PAGE + 1)}–{n0(Math.min(n, (page + 1) * PAGE))} of {n0(n)}
      </span>
      <button type="button" className="st-pg" aria-label="Newer" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <Icon name="left" size={14} />
      </button>
      <button type="button" className="st-pg" aria-label="Older" disabled={page >= last} onClick={() => onPage(page + 1)}>
        <Icon name="right" size={14} />
      </button>
    </div>
  );
}

export default function Usage({ view: asked }: { view?: "wallet" } = {}) {
  const chat = useChat();
  const { chatSyncEnabled } = useChatSync();
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  // chats sync only with a key; then copies live on the relays too
  const synced = chatSyncEnabled && !!active;
  const toast = useToast();
  const [view, setView] = useState<"requests" | "wallet">(asked ?? "requests");
  // a find jump to wallet activity opens that view, so the jump has somewhere to land
  const [wasAsked, setWasAsked] = useState(asked);
  if (asked !== wasAsked) {
    setWasAsked(asked);
    if (asked) setView(asked);
  }
  const [period, setPeriod] = useState<Period>("7d");
  // the period runs back from when it was picked
  const [pickedAt, setPickedAt] = useState(() => Date.now());
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [reqPage, setReqPage] = useState(0);
  const [read, setRead] = useState<number | null>(null);
  // a new period or filter starts from the newest again
  const refilter = () => {
    setReqPage(0);
    setRead(null);
  };
  const pickPeriod = (p: Period) => {
    if (p === period) return;
    setPeriod(p);
    setPickedAt(Date.now());
    refilter();
  };
  const after = period === "all" ? undefined : pickedAt - (period === "1d" ? D : period === "7d" ? 7 * D : 30 * D);
  const u = useSdkUsageHistory({ after, modelId: model || undefined, baseUrl: provider || undefined });
  const modelName = (id: string) => {
    const m = chat.models.find((x) => x.id === id || x.id.endsWith(`/${id}`));
    return m ? shortModelName(m.name, m.id) : id.split("/").pop() ?? id;
  };
  const modelIcon = (id: string) => {
    const m = chat.models.find((x) => x.id === id || x.id.endsWith(`/${id}`));
    return m ? renderCompanyIcon(getModelCompanyId(m), "co-ico") : null;
  };

  /* ── bars: one per hour, day or month, and each one readable ───────────── */
  const filtered = !!(model || provider);
  const bars = useMemo(() => {
    const oldest = u.entries.length ? Math.min(...u.entries.map((e) => e.timestamp)) : 0;
    const starts = buckets(period, oldest);
    const acc = starts.map((s) => ({ s, sats: 0, req: 0, tok: 0 }));
    for (const e of u.entries) {
      let j = -1;
      for (let i = starts.length - 1; i >= 0; i--)
        if (e.timestamp >= starts[i]) {
          j = i;
          break;
        }
      if (j < 0) continue;
      acc[j].sats += e.satsCost;
      acc[j].req += 1;
      acc[j].tok += e.totalTokens;
    }
    return acc;
  }, [u.entries, period]);
  const mx = Math.max(1, ...bars.map((b) => b.sats));
  const readT = useRef(0);
  const unread = () => {
    window.clearTimeout(readT.current);
    readT.current = window.setTimeout(() => setRead(null), tokenMs("--d-quick"));
  };
  const shown = read !== null ? bars[read] : { sats: u.totals.satsCost, req: u.totals.requests, tok: u.totals.totalTokens };
  const said = read !== null ? `spent ${phrase(period, bars[read].s, read === bars.length - 1, narrow())}` : "spent";
  const barKey = (e: React.KeyboardEvent, i: number) => {
    const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? bars.length - 1 : -2;
    if (j === -2) return;
    e.preventDefault();
    const k = Math.max(0, Math.min(bars.length - 1, j));
    setRead(k);
    (e.currentTarget.parentElement?.children[k] as HTMLElement | undefined)?.focus();
  };

  const ms = (t: number) => (t < 1e12 ? t * 1000 : t);

  /* ── wallet activity ───────────────────────────────────────────────────── */
  const entries = useTransactionHistoryStore((s) => s.history);
  const clearHistory = useTransactionHistoryStore((s) => s.clearHistory);
  const [apart, setApart] = useState(false);
  const [actPage, setActPage] = useState(0);
  const reqList = useFullPageHeight(u.entries.length > PAGE);
  const [pending, setPending] = useState(0);
  const [dist, setDist] = useState<{ baseUrl: string; amount: number }[]>([]);
  const { done, copy } = useCopied();
  useEffect(() => {
    const check = () => {
      setPending(getPendingCashuTokenAmount());
      setDist(getPendingCashuTokenDistribution());
    };
    check();
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, []);
  const { rows: ledger, paired } = useMemo(() => {
    const { sorted, changeOf, taken } = pairChange(entries);
    const amt = (e: (typeof sorted)[number]) => Number(e.amount) || 0;
    const out: { id: string; kind: string; amt: number; t: number }[] = [];
    for (const e of sorted) {
      if (apart) {
        out.push({ id: e.id, kind: e.direction === "out" ? "Sent" : taken.has(e.id) ? "Change" : "Received", amt: (e.direction === "in" ? 1 : -1) * amt(e), t: e.timestamp || 0 });
        continue;
      }
      if (taken.has(e.id)) continue;
      if (e.direction === "in") out.push({ id: e.id, kind: "Received", amt: amt(e), t: e.timestamp || 0 });
      else {
        // one reply as what it really cost: the payment less its change
        const c = changeOf.get(e.id);
        out.push({ id: c ? `${e.id}-${c.id}` : e.id, kind: c ? "Spent" : "Sent", amt: -(amt(e) - (c ? amt(c) : 0)), t: e.timestamp || 0 });
      }
    }
    return { rows: out.sort((a, b) => b.t - a.t).slice(0, 60), paired: changeOf.size };
  }, [entries, apart]);
  const actList = useFullPageHeight(ledger.length > PAGE);

  /* ── clearing ──────────────────────────────────────────────────────────── */
  const [ask, setAsk] = useState<"" | "log" | "pay" | "chats">("");
  const chats = chat.conversations.length;

  return (
    <>
      <header className="st-head">
        <h2 className="st-t" id="st-title" tabIndex={-1}>
          Usage
        </h2>
        <p className="st-lede">
          <span className="st-s">Every request and every payment, kept only in this browser.</span>
        </p>
        <div className="st-headseg">
          <Seg
            label="View"
            tabs
            opts={[
              ["requests", "Requests"],
              ["wallet", "Wallet activity"],
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </header>

      {view === "requests" ? (
        <div className="st-view">
          <Grp id="g-req" k="Requests" kv={u.hasUsage ? PERIOD_LBL[period] : ""}>
            {/* nothing to filter yet: no filters */}
            {u.hasUsage && (
            <div className="st-filters">
              <Seg
                label="Period"
                opts={[
                  ["1d", "24h"],
                  ["7d", "7d"],
                  ["30d", "30d"],
                  ["all", "All"],
                ]}
                value={period}
                onChange={pickPeriod}
              />
              <span className="grow" />
              {/* a menu with nothing in it is not shown */}
              {u.models.length > 0 && (
              <label className="st-sel">
                <span className="sr">Model</span>
                <select
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    refilter();
                  }}
                >
                  <option value="">All models</option>
                  {u.models.map((m) => (
                    <option key={m} value={m}>
                      {modelName(m)}
                    </option>
                  ))}
                </select>
                <span>{model ? modelName(model) : "All models"}</span>
                <Icon name="down" size={14} />
              </label>
              )}
              {u.providers.length > 0 && (
              <label className="st-sel">
                <span className="sr">Provider</span>
                <select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    refilter();
                  }}
                >
                  <option value="">All providers</option>
                  {u.providers.map((p) => (
                    <option key={p} value={p}>
                      {hostOf(p)}
                    </option>
                  ))}
                </select>
                <span>{provider ? hostOf(provider) : "All providers"}</span>
                <Icon name="down" size={14} />
              </label>
              )}
            </div>
            )}
            {u.isLoading ? (
              <>
                <div className="st-stats">
                  {[0, 1, 2].map((i) => (
                    <div key={i}>
                      <i className="st-ghost" style={{ width: "64%", height: 22 }} />
                      <i className="st-ghost" style={{ width: "40%" }} />
                    </div>
                  ))}
                </div>
                <div className="st-ghostlist">
                  {Array.from({ length: 5 }, (_, i) => (
                    <i key={i}>
                      <b />
                      <s />
                    </i>
                  ))}
                </div>
              </>
            ) : u.error ? (
              <div className="st-emptyrow warn">
                <span className="st-it-ic">
                  <Icon name="retry" />
                </span>
                <p className="st-rn">Could not read the usage log in this browser. Your chats and sats are fine.</p>
              </div>
            ) : !u.hasUsage ? (
              <div className="st-emptyrow">
                <span className="st-it-ic">
                  <Icon name="coin" />
                </span>
                <p className="st-rn">No requests yet. Each reply you pay for shows up here with its tokens and cost.</p>
              </div>
            ) : (
              <>
                <div className="st-stats">
                  <div>
                    <div className="st-stat-v">
                      <Roll className="st-roll" text={sats(shown.sats)} />
                      <span className="u">{satUnit(shown.sats)}</span>
                    </div>
                    <div className="st-stat-k">
                      <Roll className="st-roll" text={said} />
                    </div>
                  </div>
                  <div>
                    <div className="st-stat-v">
                      <Roll className="st-roll" text={n0(shown.req)} />
                    </div>
                    <div className="st-stat-k">requests</div>
                  </div>
                  <div>
                    <div className="st-stat-v">
                      <Roll className="st-roll" text={fmtTok(shown.tok)} />
                    </div>
                    <div className="st-stat-k">tokens</div>
                  </div>
                </div>
                {!filtered && (
                  <div
                    className="st-bars"
                    data-n={bars.length}
                    data-reading={read !== null ? "" : undefined}
                    role="group"
                    aria-label={`Sats spent per ${period === "1d" ? "hour" : period === "all" ? "month" : "day"}. Arrow keys read each one.`}
                    onPointerLeave={unread}
                  >
                    {bars.map((b, i) => {
                      const ph = phrase(period, b.s, i === bars.length - 1, false);
                      return (
                        <button
                          key={b.s}
                          type="button"
                          className="st-col"
                          data-now={i === bars.length - 1 ? "" : undefined}
                          data-hot={read === i ? "" : undefined}
                          tabIndex={i === bars.length - 1 ? 0 : -1}
                          style={{ "--h": Math.max(b.sats / mx, b.sats ? 0.05 : 0).toFixed(3), "--i": i } as React.CSSProperties}
                          aria-label={b.sats ? `${sats(b.sats)} ${satUnit(b.sats)} spent ${ph}, ${plural(b.req, "request")}` : `Nothing spent ${ph}`}
                          onPointerEnter={() => {
                            window.clearTimeout(readT.current);
                            setRead(i);
                          }}
                          onFocus={() => setRead(i)}
                          onBlur={unread}
                          onClick={() => setRead(i)}
                          onKeyDown={(e) => barKey(e, i)}
                        >
                          <i />
                          <em>{tick(period, b.s, i, bars.length)}</em>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!u.entries.length ? (
                  <div className="st-emptyrow">
                    <span className="st-it-ic">
                      <Icon name="search" />
                    </span>
                    <p className="st-rn">
                      {model || provider ? "No requests match these filters." : `Nothing in the ${PERIOD_LBL[period].toLowerCase().replace(/^last /, "last ")}.`}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="st-tbl" role="table" aria-label="Requests" ref={reqList}>
                      <div className="st-tr st-th" role="row">
                        <span role="columnheader">Model</span>
                        <span role="columnheader">Provider</span>
                        <span className="num" role="columnheader">
                          Tokens
                        </span>
                        <span className="num" role="columnheader">
                          Cost
                        </span>
                        <span className="num" role="columnheader">
                          When
                        </span>
                      </div>
                      {u.entries.slice(reqPage * PAGE, (reqPage + 1) * PAGE).map((e) => (
                        <div className="st-tr" role="row" key={e.id}>
                          <span className="st-mod" role="cell">
                            {modelIcon(e.modelId) && (
                              <span className="st-mod-ic" aria-hidden="true">
                                {modelIcon(e.modelId)}
                              </span>
                            )}
                            <span>{modelName(e.modelId)}</span>
                          </span>
                          <span className="dim" role="cell">
                            {hostOf(e.baseUrl)}
                          </span>
                          <span className="num dim" role="cell" title={`${n0(e.promptTokens)} in, ${n0(e.completionTokens)} out`}>
                            {fmtTok(e.totalTokens)}
                          </span>
                          <span className="num" role="cell">
                            {sats(e.satsCost)}
                            <span className="u"> {satUnit(e.satsCost)}</span>
                          </span>
                          <span className="num dim" role="cell">
                            {when(ms(e.timestamp))}
                          </span>
                        </div>
                      ))}
                    </div>
                    <Pager n={u.entries.length} page={reqPage} onPage={setReqPage} />
                  </>
                )}
              </>
            )}
          </Grp>
        </div>
      ) : (
        <div className="st-view">
          <Grp id="g-act" k="Wallet activity" kv="">
            {pending > 0 && (
              <div className="st-note-row st-tintrow st-pending">
                <div>
                  <p className="st-rt">
                    <span className="st-dot" data-s="wait" aria-hidden="true" />
                    {n0(pending)} {satUnit(pending)} on their way back
                  </p>
                  <p className="st-rn">Held by providers, returning as change{dist.length ? `: ${dist.map((d) => `${hostOf(d.baseUrl)} ${n0(d.amount)}`).join(", ")}` : ""}.</p>
                </div>
                <Btn
                  icon="copy"
                  done={done === "pending"}
                  onClick={() => {
                    const t = getLocalCashuTokens().map((x) => x.token).join("\n");
                    if (t) void copy(t, "pending");
                  }}
                >
                  {done === "pending" ? "Copied" : "Copy token"}
                </Btn>
              </div>
            )}
            {/* only when some payment got change back: otherwise the switch has nothing to part */}
            {paired > 0 && (
            <div className="st-row st-master">
              <div className="st-txt">
                <p className="st-rt">Show payment and change apart</p>
              </div>
              <div className="st-ctl">
                <Sw
                  on={apart}
                  label="Show payment and change apart"
                  onChange={(v) => {
                    setApart(v);
                    setActPage(0);
                  }}
                />
              </div>
            </div>
            )}
            {!ledger.length ? (
              <div className="st-emptyrow">
                <span className="st-it-ic">
                  <Icon name="wallet" />
                </span>
                <p className="st-rn">No payments yet. Money in and out shows here.</p>
              </div>
            ) : (
              <>
              <div className="st-items st-ledger" ref={actList}>
                {ledger.slice(actPage * PAGE, (actPage + 1) * PAGE).map((e) => (
                  <div className="st-it noic" key={e.id}>
                    <div className="st-it-m">
                      <span className="st-it-t">{e.kind}</span>
                      <span className="st-it-s">{e.t ? when(ms(e.t)) : ""}</span>
                    </div>
                    <div className="st-it-r">
                      <span className="st-amt" data-dir={e.amt > 0 ? "in" : "out"}>
                        {e.amt > 0 ? "+" : "−"}
                        {n0(Math.abs(e.amt))}
                        <span className="u"> {satUnit(Math.abs(e.amt))}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <Pager n={ledger.length} page={actPage} onPage={setActPage} />
              </>
            )}
          </Grp>
        </div>
      )}

      <Grp id="g-clear" k="Clear">
        <div className="st-row wrap" id="r-clrlog">
          <div className="st-txt">
            <p className="st-rt">Clear the usage log</p>
            <p className="st-rn">Removes the list of requests. Chats and sats stay.</p>
          </div>
          <div className="st-ctl">
            <Btn controls="f-clrlog" open={ask === "log"} disabled={!u.hasUsage} onClick={() => setAsk(ask === "log" ? "" : "log")}>
              Clear log
            </Btn>
          </div>
        </div>
        <Fold id="f-clrlog" open={ask === "log"}>
          <Say
            acts={
              <>
                <Btn onClick={() => setAsk("")}>Cancel</Btn>
                <Btn
                  kind="warn"
                  icon="trash"
                  onClick={async () => {
                    await u.clearUsage();
                    setAsk("");
                    toast("Usage log cleared");
                  }}
                >
                  Clear log
                </Btn>
              </>
            }
          >
            <p>Clear every request record from this browser?</p>
          </Say>
        </Fold>
        <div className="st-row wrap" id="r-clrpay">
          <div className="st-txt">
            <p className="st-rt">Clear payment records</p>
            <p className="st-rn">Removes the activity list. Your sats are not touched.</p>
          </div>
          <div className="st-ctl">
            <Btn controls="f-clrpay" open={ask === "pay"} disabled={!entries.length} onClick={() => setAsk(ask === "pay" ? "" : "pay")}>
              Clear records
            </Btn>
          </div>
        </div>
        <Fold id="f-clrpay" open={ask === "pay"}>
          <Say
            acts={
              <>
                <Btn onClick={() => setAsk("")}>Cancel</Btn>
                <Btn
                  kind="warn"
                  icon="trash"
                  onClick={() => {
                    // the records only: sats held with providers keep their tokens
                    chat.setTransactionHistory([]);
                    clearHistory();
                    setAsk("");
                    toast("Payment records cleared");
                  }}
                >
                  Clear records
                </Btn>
              </>
            }
          >
            <p>Clear all payment records? Your balance stays as it is.</p>
          </Say>
        </Fold>
        <div className="st-row wrap" id="r-delchats">
          <div className="st-txt">
            <p className="st-rt">Delete all chats</p>
            <p className="st-rn">
              {synced ? "Removes every chat from this device. Copies on your relays stay, and come back when this device syncs." : "Removes every chat from this device."}
            </p>
          </div>
          <div className="st-ctl">
            <Btn controls="f-delchats" open={ask === "chats"} disabled={!chats} onClick={() => setAsk(ask === "chats" ? "" : "chats")}>
              Delete chats
            </Btn>
          </div>
        </div>
        <Fold id="f-delchats" open={ask === "chats"}>
          <Say
            warn
            acts={
              <>
                <Btn onClick={() => setAsk("")}>Keep them</Btn>
                <Btn
                  kind="warn"
                  icon="trash"
                  onClick={() => {
                    chat.clearConversations();
                    setAsk("");
                    toast("All chats deleted");
                  }}
                >
                  Delete all chats
                </Btn>
              </>
            }
          >
            <p>
              <b>Delete all {plural(chats, "chat")} from this device?</b>{" "}
              {synced ? "They stay on your relays and come back with the next sync." : "This cannot be undone."}
            </p>
          </Say>
        </Fold>
      </Grp>
    </>
  );
}
