"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getDecodedToken } from "@cashu/cashu-ts";
import { Icon } from "../icons";
import { useMoney } from "../useMoney";
import { useFunding } from "./useFunding";
import { usePendingInvoices, usePerReply, useActiveMint } from "./Wallet";
import { Amount, Clock, Code, CopyLine, Done, Note, NumT, Pane, Pasted, Picks, Seg, Spin, Two, Warn, fmt, flipFrom, host, useCopy } from "./bits";

/* Adding money. Lightning: type an amount (what it buys shows as you type),
   then the typed number becomes the invoice's title while its code prints in.
   Cashu token: paste it, see what it holds and from where, then take it.
   Money only moves through useFunding, which calls the wallet's own hooks. */

export type Reopen = { id: string; quoteId: string; amount: number; pr: string; exp: number; mintUrl: string };
const isLn = (t: string) => /^ln(bc|tb|bcrt)/i.test(t.trim().replace(/^lightning:/i, ""));
const PAID_HOLD = 1500;

export default function Add({
  reopen,
  clearReopen,
  say,
  landing,
  land,
  toPay,
}: {
  reopen: Reopen | null;
  clearReopen: () => void;
  say: (t: string) => void;
  landing: (before: number | null) => void;
  land: () => void;
  toPay: (invoice: string) => void;
}) {
  const funding = useFunding();
  const money = useMoney();
  const mint = useActiveMint();
  const { per, name } = usePerReply();
  const pending = usePendingInvoices();
  const { copied, copy } = useCopy(say);
  const [tab, setTab] = useState<0 | 1>(0);
  const [dir, setDir] = useState<"r" | "l" | "u" | "flip" | undefined>();
  const [amt, setAmt] = useState("");
  const [bump, setBump] = useState(0);
  const field = useRef<HTMLLabelElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  const flip = useRef<DOMRect | null>(null);
  const before = useRef(0);

  // an invoice is made from the typed number: it flips into the title
  const create = (n: number, retry = false) => {
    if (!(n > 0)) return;
    flip.current = retry ? null : field.current?.getBoundingClientRect() ?? null;
    before.current = money.total;
    setDir(retry ? undefined : "flip");
    funding.createInvoice(n);
  };
  useLayoutEffect(() => {
    if (!flip.current || funding.status !== "creating") return;
    flipFrom(num.current, flip.current);
    flip.current = null;
  }, [funding.status]);

  // the code prints in once, when the mint answers
  const [printed, setPrinted] = useState(true);
  useEffect(() => {
    if (funding.status !== "waiting") return;
    setPrinted(false);
    const t = window.setTimeout(() => setPrinted(true), 900);
    window.setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected) document.querySelector<HTMLElement>('[data-v="add"] .wl-lnstr')?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [funding.status]);

  // the connected wallet started to pay and stopped while the invoice still waits
  const [walletFail, setWalletFail] = useState(false);
  const wasPaying = useRef(false);
  useEffect(() => {
    if (wasPaying.current && !funding.walletPaying && funding.status === "waiting") setWalletFail(true);
    if (funding.walletPaying) setWalletFail(false);
    wasPaying.current = funding.walletPaying;
  }, [funding.walletPaying, funding.status]);

  // a quote runs out at the mint's deadline
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    const at = funding.expiresAt;
    if (!at || funding.status !== "waiting") return;
    const t = window.setTimeout(() => setExpired(true), Math.max(0, at - Date.now()));
    return () => window.clearTimeout(t);
  }, [funding.expiresAt, funding.status]);

  // paid: the ring shows, then the card pans home and the digits roll
  const paidT = useRef(0);
  const settle = (sats: number) => {
    say(`${fmt(sats)} sats received`);
    landing(before.current);
    window.clearTimeout(paidT.current);
    paidT.current = window.setTimeout(() => {
      land();
      window.setTimeout(() => {
        funding.reset();
        setAmt("");
        setTok({ text: "", state: "idle" });
        setDir(undefined);
      }, 400);
    }, PAID_HOLD);
  };
  useEffect(() => {
    if (funding.status === "paid" && tab === 0 && !tok.got) settle(funding.amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funding.status]);
  useEffect(() => () => window.clearTimeout(paidT.current), []);
  const addMore = () => {
    window.clearTimeout(paidT.current);
    landing(null);
    funding.reset();
    setAmt("");
    setTok({ text: "", state: "idle" });
    setDir("u");
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-v="add"] input, [data-v="add"] textarea')?.focus({ preventScroll: true }));
  };

  /* ── a reopened invoice from Waiting ───────────────────────────────────── */
  const stillWaiting = reopen ? pending.some((p) => p.id === reopen.id) : false;
  const reopenPaid = useRef(false);
  useEffect(() => {
    if (!reopen) return;
    if (!stillWaiting && !reopenPaid.current && Date.now() < reopen.exp) {
      reopenPaid.current = true;
      before.current = money.total - reopen.amount;
      settle(reopen.amount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillWaiting]);
  useEffect(() => {
    reopenPaid.current = false;
  }, [reopen?.id]);

  /* ── a Cashu token ─────────────────────────────────────────────────────── */
  const [tok, setTok] = useState<{ text: string; state: "idle" | "busy" | "failed" | "done"; got?: number }>({ text: "", state: "idle" });
  const read = useMemo(() => {
    const t = tok.text.trim();
    if (!t) return null;
    if (isLn(t)) return { kind: "ln" as const };
    try {
      const d = getDecodedToken(t);
      const total = d.proofs.reduce((s, p) => s + p.amount, 0);
      return { kind: "token" as const, sats: d.unit === "msat" ? Math.floor(total / 1000) : total, mint: d.mint };
    } catch {
      return t.length >= 12 ? { kind: "junk" as const } : null;
    }
  }, [tok.text]);
  const receive = async () => {
    if (read?.kind !== "token") return;
    before.current = money.total;
    setTok((x) => ({ ...x, state: "busy" }));
    const got = await funding.redeemToken(tok.text);
    if (got < 0) return; // a second press while the first swap runs
    if (got > 0) {
      setTok((x) => ({ ...x, state: "done", got }));
      settle(got);
    } else setTok((x) => ({ ...x, state: "failed" }));
  };
  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (t) setTok({ text: t, state: "idle" });
    } catch {
      document.querySelector<HTMLTextAreaElement>("#wlTokIn")?.focus();
    }
  };
  const spent = tok.state === "failed" && /spent|already|claimed|redeemed/i.test(funding.message);
  useEffect(() => {
    if (tok.state !== "failed") return;
    say(spent ? "Someone already claimed it, so nothing was added." : "The token could not be received. Nothing changed in your wallet.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tok.state]);

  const pick = (i: 0 | 1) => {
    if (i === tab) return;
    setDir(i > tab ? "r" : "l");
    setTab(i);
  };

  /* ── what shows ────────────────────────────────────────────────────────── */
  const mn = mint.active?.name ?? "the mint";
  const change = (
    <button
      type="button"
      className="wl-textlink"
      onClick={() => {
        if (reopen) {
          clearReopen();
          setDir("l");
          return;
        }
        funding.reset();
        setDir("l");
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-v="add"] input')?.focus({ preventScroll: true }));
      }}
    >
      Change amount
    </button>
  );
  let body: React.ReactNode;
  let done = false;
  if (tab === 0) {
    const s = funding.status;
    if (reopen && !(reopenPaid.current && s === "idle")) {
      const exp = Date.now() > reopen.exp;
      body = reopenPaid.current ? (
        <Pane dir="u" fill={<Done title={`${fmt(reopen.amount)} sats received`} line="Added to your wallet" />} main={<AddMore onClick={addMore} />} />
      ) : (
        <Pane
          cls="is-inv"
          dir={dir}
          fill={
            <div className="wl-inv">
              <NumT n={reopen.amount} />
              {exp ? (
                <div className="wl-qr fail quiet" role="status">
                  <Clock />
                  <p>This invoice expired.</p>
                  <p>Nothing was paid. Make a new one for the same amount.</p>
                </div>
              ) : (
                <>
                  <Code value={reopen.pr} printed copied={copied === "inv"} label="Copy invoice" onCopy={() => void copy(reopen.pr, "inv")} />
                  <CopyLine value={reopen.pr} copied={copied === "inv"} label="Copy invoice" onCopy={() => void copy(reopen.pr, "inv")} />
                </>
              )}
              <div className="wl-inv-slot">
                {!exp && (
                  <p className="wl-status" role="status">
                    <span className="wl-live" />
                    Waiting for payment
                  </p>
                )}
              </div>
            </div>
          }
          main={
            exp ? (
              <button
                type="button"
                className="wl-go"
                onClick={() => {
                  clearReopen();
                  create(reopen.amount, true);
                }}
              >
                <Icon name="retry" size={16} />
                Make a new one
              </button>
            ) : null
          }
          after={change}
        />
      );
    } else if (s === "idle") {
      const n = +amt || 0;
      body = (
        <Pane
          dir={dir}
          fill={
            <div className="wl-amtset">
              <Amount
                value={amt}
                onChange={setAmt}
                onEnter={() => create(n)}
                bump={bump}
                fieldRef={field}
                buys={
                  n > 0 && per > 0 ? (
                    <Two
                      a={
                        <>
                          About <b>{fmt(Math.max(1, Math.floor(n / per)))} {Math.floor(n / per) === 1 ? "reply" : "replies"}</b>
                        </>
                      }
                      b={`with ${name}`}
                    />
                  ) : (
                    <Two a="Type an amount" b="or pick one below" />
                  )
                }
              />
              <Picks
                list={[500, 1000, 5000].map((p) => [p, fmt(p)] as [number, string])}
                value={n}
                onPick={(p) => {
                  setAmt(String(p));
                  setBump((b) => b + 1);
                }}
              />
            </div>
          }
          main={
            <button type="button" className="wl-go" disabled={!(n > 0)} onClick={() => create(n)}>
              Create invoice
            </button>
          }
          after={<p className="wl-hint">Pay it from any Lightning wallet. The sats land here, on {mn}.</p>}
        />
      );
    } else if (s === "paid") {
      done = true;
      body = <Pane dir="u" fill={<Done title={`${fmt(funding.amount)} sats received`} line="Added to your wallet" />} main={<AddMore onClick={addMore} />} />;
    } else {
      const inv = funding.invoice || "";
      const paying = funding.walletPaying;
      let code: React.ReactNode;
      let line: React.ReactNode = null;
      let status: React.ReactNode = null;
      let main: React.ReactNode;
      if (s === "creating") {
        code = (
          <div className="wl-qr wait" aria-hidden="true">
            <i />
            <i />
            <i />
            <b />
          </div>
        );
        line = (
          <div className="wl-lnstr" aria-hidden="true">
            <span className="wl-ghost" />
            <span className="ic" />
          </div>
        );
        status = (
          <p className="wl-status" role="status">
            <Spin />
            Asking {mn} for an invoice
          </p>
        );
        main = (
          <button type="button" className="wl-soft" disabled>
            <Icon name="bolt" size={16} />
            Pay from a connected wallet
          </button>
        );
      } else if (s === "error" && !inv) {
        code = (
          <div className="wl-qr fail" role="alert">
            <Warn size={22} />
            <p>{mn} did not answer.</p>
            <p>Nothing was charged. Try again, or pick another mint below.</p>
          </div>
        );
        main = (
          <button type="button" className="wl-go" onClick={() => create(funding.amount, true)}>
            <Icon name="retry" size={16} />
            Try again
          </button>
        );
      } else if (expired) {
        code = (
          <div className="wl-qr fail quiet" role="status">
            <Clock />
            <p>This invoice expired.</p>
            <p>Nothing was paid. Make a new one for the same amount.</p>
          </div>
        );
        main = (
          <button type="button" className="wl-go" onClick={() => create(funding.amount, true)}>
            <Icon name="retry" size={16} />
            Make a new one
          </button>
        );
      } else {
        code = <Code value={inv} printed={printed} copied={copied === "inv"} label="Copy invoice" onCopy={() => void copy(inv, "inv")} />;
        line = <CopyLine value={inv} copied={copied === "inv"} label="Copy invoice" onCopy={() => void copy(inv, "inv")} />;
        status = walletFail ? (
          <Note kind="warn" center text="Your wallet did not pay. Nothing was sent, and the invoice still works." />
        ) : (
          <p className="wl-status" role="status">
            <span className="wl-live" />
            {paying ? "Payment on its way" : "Waiting for payment"}
          </p>
        );
        main = (
          <button type="button" className="wl-soft" data-busy={paying ? "" : undefined} disabled={paying} onClick={() => void funding.payFromWallet()}>
            {paying ? (
              <>
                <Spin />
                Paying from your wallet
              </>
            ) : (
              <>
                <Icon name={walletFail ? "retry" : "bolt"} size={16} />
                {!funding.walletConnected ? "Connect a wallet to pay" : walletFail ? "Try your wallet again" : "Pay from a connected wallet"}
              </>
            )}
          </button>
        );
      }
      body = (
        <Pane
          cls="is-inv"
          dir={dir}
          fill={
            <div className="wl-inv">
              <NumT n={funding.amount} numRef={num} />
              {code}
              {line}
              <div className="wl-inv-slot">{status}</div>
            </div>
          }
          main={main}
          // nothing to change while the mint is still making the invoice: a late
          // answer would land under a different amount
          after={s === "creating" ? null : change}
        />
      );
    }
  } else if (tok.state === "done") {
    done = true;
    body = <Pane dir="u" fill={<Done title={`${fmt(tok.got ?? 0)} sats received`} line="Added to your wallet" />} main={<AddMore onClick={addMore} />} />;
  } else {
    const busy = tok.state === "busy";
    // cleared, the field is back and has the focus (the x that was pressed is gone)
    const clear = () => {
      setTok({ text: "", state: "idle" });
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("#wlTokIn")?.focus());
    };
    const readBack = !!read && (read.kind === "token" || read.kind === "ln");
    let back: React.ReactNode;
    let main: React.ReactNode = (
      <button type="button" className="wl-go" disabled>
        Receive
      </button>
    );
    if (read?.kind === "token" && spent) {
      back = (
        <div className="wl-read is-spent">
          <p className="wl-read-k">In this token</p>
          <p className="wl-read-n">
            {fmt(read.sats)}
            <small>sats</small>
          </p>
          <Note kind="warn" center text="Someone already claimed it, so nothing was added. Ask whoever sent it for a new one." />
        </div>
      );
      main = (
        <button type="button" className="wl-soft" onClick={clear}>
          <Icon name="paste" size={15} />
          Paste another token
        </button>
      );
    } else if (read?.kind === "token") {
      const known = mint.all.some((m) => m.url === read.mint);
      back = (
        <div className="wl-read">
          <p className="wl-read-k">In this token</p>
          <p className="wl-read-n">
            {fmt(read.sats)}
            <small>sats</small>
          </p>
          {tok.state === "failed" ? (
            <Note kind="warn" center text="The token could not be received. Nothing changed in your wallet." />
          ) : known ? (
            <p className="wl-read-s">
              From <b>{host(read.mint)}</b>, one of your mints. Taking it swaps it for fresh ecash, so nobody else can spend it after.
            </p>
          ) : (
            <p className="wl-read-s">
              From <b>{host(read.mint)}</b>, a mint you have not used yet. Taking it adds this mint, and these sats will live there.
            </p>
          )}
        </div>
      );
      main = (
        <button type="button" className="wl-go" data-busy={busy ? "" : undefined} disabled={busy} onClick={() => void receive()}>
          {busy ? (
            <>
              <Spin />
              Receiving
            </>
          ) : tok.state === "failed" ? (
            <>
              <Icon name="retry" size={16} />
              Try again
            </>
          ) : (
            `Receive ${fmt(read.sats)} sats`
          )}
        </button>
      );
    } else if (read?.kind === "ln") {
      back = (
        <div className="wl-read">
          <p className="wl-read-k">A Lightning invoice</p>
          <Note kind="info" center text="That is a Lightning invoice, not a token. You can pay it from Send." />
        </div>
      );
      main = (
        <button type="button" className="wl-go" onClick={() => toPay(tok.text.trim().replace(/^lightning:/i, ""))}>
          <Icon name="arrowUp" size={16} />
          Pay this invoice instead
        </button>
      );
    } else if (read?.kind === "junk") {
      back = <Note kind="warn" text="That does not look like a Cashu token. It should start with cashuA or cashuB." />;
    } else {
      back = <p className="wl-hint">A token is money written as text. Anyone holding it can claim it, so take it in right away.</p>;
    }
    body = (
      <Pane
        cls="is-top"
        dir={dir}
        fill={
          <>
            {readBack ? (
              <Pasted text={tok.text.trim()} label={read?.kind === "ln" ? "Lightning invoice" : "Cashu token"} onClear={busy ? undefined : clear} />
            ) : (
              <div className="wl-paste">
                <textarea
                  id="wlTokIn"
                  rows={4}
                  spellCheck={false}
                  aria-label="Cashu token"
                  placeholder="Paste a Cashu token"
                  value={tok.text}
                  onChange={(e) => setTok({ text: e.target.value, state: "idle" })}
                />
                {tok.text ? (
                  <button type="button" className="wl-clear" aria-label="Clear" onClick={clear}>
                    <Icon name="close" size={14} />
                  </button>
                ) : (
                  <button type="button" className="wl-link" onClick={() => void paste()}>
                    <Icon name="paste" size={15} />
                    Paste
                  </button>
                )}
              </div>
            )}
            {back}
          </>
        }
        main={main}
      />
    );
  }

  return (
    <>
      <Seg label="How to add funds" a="Lightning" b="Cashu token" i={tab} done={done} onPick={pick} />
      {body}
    </>
  );
}

function AddMore({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="wl-soft" onClick={onClick}>
      <Icon name="arrowDown" size={16} />
      Add more
    </button>
  );
}
