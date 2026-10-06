"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWalletSend } from "@/features/wallet/hooks/useWalletSend";
import { useUnclaimedTokensStore, type UnclaimedToken } from "@/features/wallet/state/unclaimedTokensStore";
import { Icon } from "../icons";
import { tokenMs } from "../motion";
import { satsOf, useActiveMint } from "./Wallet";
import { Amount, Code, CopyLine, Done, Note, NumT, Pane, Pasted, Picks, Seg, Share, Spin, Two, ago, fmt, flipFrom, useCopy } from "./bits";

/* Sending is useWalletSend: a made token is written to the wallet book the
   moment it exists, and it stays listed until
   it is taken back or you let it go. A Lightning payment shows the worst case
   (amount plus the most the network may take) before anything is paid. */

type Kind = "ok" | "info" | "warn";
const noAmount = (inv: string) => {
  const v = inv.toLowerCase();
  return v.slice(0, v.lastIndexOf("1")).replace(/^ln(bcrt|bc|tb)/, "") === "";
};
const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function" && window.matchMedia("(max-width: 760px)").matches;

/** Take a token back and say what happened: back in the wallet, already claimed, or not now. */
function useTakeBack(s: ReturnType<typeof useWalletSend>, onDone: (id: string, kind: Kind, text: string) => void) {
  const was = useRef<{ id: string; amount: number } | null>(null);
  useEffect(() => {
    const w = was.current;
    if (!w || s.reclaimingTokenId) return;
    was.current = null;
    if (/already redeemed/i.test(s.warningMessage)) onDone(w.id, "info", "That token was already claimed, so it has left this list.");
    else if (s.error) onDone(w.id, "warn", "It could not be taken back just now. Nothing changed. Try again in a moment.");
    else onDone(w.id, "ok", `Took back ${fmt(w.amount)} sats.`);
  }, [s.reclaimingTokenId]);
  return (t: UnclaimedToken) => {
    was.current = { id: t.id, amount: satsOf(t.amount, t.unit) };
    void s.reclaimUnclaimedToken(t);
  };
}

export default function Send({
  say,
  toTokens,
  toAdd,
  prefill,
  clearPrefill,
}: {
  say: (t: string) => void;
  toTokens: () => void;
  toAdd: () => void;
  prefill: string | null;
  clearPrefill: () => void;
}) {
  const s = useWalletSend();
  const tokens = useUnclaimedTokensStore((x) => x.unclaimedTokens);
  const mint = useActiveMint();
  const { copied, copy } = useCopy(say);
  // the same order as Add (Lightning, then token); a token is the default here
  const [tab, setTab] = useState<0 | 1>(1);
  const [dir, setDir] = useState<"r" | "l" | "u" | "flip" | undefined>();
  const [bump, setBump] = useState(0);
  const [made, setMade] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: Kind; text: string; n: number } | null>(null);
  const field = useRef<HTMLLabelElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  const flip = useRef<DOMRect | null>(null);

  // a note in the dock's quiet slot says what just happened, for four seconds
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote((x) => (x?.n === note.n ? null : x)), 4000);
    return () => window.clearTimeout(t);
  }, [note]);

  /* ── a token ───────────────────────────────────────────────────────────── */
  const have = mint.bal;
  const n = +s.sendAmount || 0;
  const make = async () => {
    if (!(n > 0 && n <= have) || s.isGeneratingSendToken) return;
    const before = new Set(tokens.map((t) => t.id));
    flip.current = field.current?.getBoundingClientRect() ?? null;
    await s.generateSendToken();
    const fresh = useUnclaimedTokensStore.getState().unclaimedTokens.find((t) => !before.has(t.id));
    if (!fresh) return;
    setNote(null);
    setDir("flip");
    setMade(fresh.id);
    say(`Token made for ${fmt(satsOf(fresh.amount, fresh.unit))} sats`);
  };
  useLayoutEffect(() => {
    if (!made || !flip.current) return;
    flipFrom(num.current, flip.current);
    flip.current = null;
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-v="send"] .wl-lnstr')?.focus({ preventScroll: true }));
  }, [made]);
  const takeBack = useTakeBack(s, (id, kind, text) => {
    if (id !== made) return;
    setMade(null);
    setDir("u");
    setNote({ kind, text, n: Date.now() });
    say(text);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-v="send"] input')?.focus({ preventScroll: true }));
  });

  /* ── a Lightning invoice ───────────────────────────────────────────────── */
  const [ln, setLn] = useState("");
  // what is typed stays a draft: an invoice is read when pasted, or on Enter
  const [draft, setDraft] = useState("");
  // paid, or sent and still settling on a slow route
  const [lnPaid, setLnPaid] = useState<{ n: number; pending: boolean } | null>(null);
  const lnAmt = useRef(0);
  const bare = (v: string) => v.trim().replace(/^lightning:/i, "");
  const lookUp = (t: string) => {
    s.setError("");
    if (!/^ln(bc|tb|bcrt)/i.test(t) || noAmount(t)) return;
    void s.handleNip60InvoiceInput(t);
  };
  const read = (v: string) => {
    const t = bare(v);
    setLn(t);
    lookUp(t);
  };
  // an invoice handed over from elsewhere opens on the Lightning tab, read at once
  const [handed, setHanded] = useState<string | null>(null);
  if (prefill !== handed) {
    setHanded(prefill);
    if (prefill) {
      setTab(0);
      setDir("l");
      setLn(bare(prefill));
    }
  }
  useEffect(() => {
    if (!prefill) return;
    lookUp(bare(prefill));
    clearPrefill();
  }, [prefill]);
  const cancel = (refocus = true) => {
    s.handleNip60PaymentCancel();
    s.setError("");
    setLn("");
    setDraft("");
    if (refocus) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("#wlLnIn")?.focus());
  };
  const wasPaying = useRef(false);
  useEffect(() => {
    if (wasPaying.current && !s.isNip60Processing && /^(Paid|Sending)/i.test(s.successMessage)) {
      const pending = /^Sending/i.test(s.successMessage);
      setLnPaid({ n: lnAmt.current, pending });
      setLn("");
      say(pending ? `Sending ${fmt(lnAmt.current)} sats. Waiting for the network.` : `Paid ${fmt(lnAmt.current)} sats`);
    }
    wasPaying.current = s.isNip60Processing;
  }, [s.isNip60Processing, s.successMessage]);
  const pay = () => {
    lnAmt.current = s.invoiceAmount ?? 0;
    void s.handlePayLightningInvoice();
  };
  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (t) read(t);
    } catch {
      document.querySelector<HTMLTextAreaElement>("#wlLnIn")?.focus();
    }
  };

  const pick = (i: 0 | 1) => {
    if (i === tab) return;
    setDir(i > tab ? "r" : "l");
    setTab(i);
  };

  let body: React.ReactNode;
  let done = false;
  const mn = mint.active?.name ?? "this mint";
  if (tab === 1) {
    const t = made ? tokens.find((x) => x.id === made) : null;
    if (t) {
      const sats = satsOf(t.amount, t.unit);
      const busy = s.reclaimingTokenId === t.id;
      body = (
        <Pane
          cls="is-inv"
          dir={dir}
          fill={
            <div className="wl-inv">
              <NumT n={sats} numRef={num} />
              <Code value={t.token} printed={dir !== "flip"} copied={copied === t.id} label="Copy token" onCopy={() => void copy(t.token, t.id)} />
              <div className="wl-strrow">
                <CopyLine value={t.token} copied={copied === t.id} label="Copy token" onCopy={() => void copy(t.token, t.id)} />
                {canShare() && (
                  <button type="button" className="wl-share" aria-label="Share token" onClick={() => void navigator.share({ text: t.token }).catch(() => {})}>
                    <Share />
                  </button>
                )}
              </div>
              <div className="wl-inv-slot">
                <p className="wl-status" role="status">
                  Anyone holding this can claim it. Until they do, you can take it back.
                </p>
              </div>
            </div>
          }
          main={
            <div className="wl-two">
              <button type="button" className="wl-soft" data-busy={busy ? "" : undefined} disabled={busy} onClick={() => takeBack(t)}>
                {busy ? (
                  <>
                    <Spin />
                    Taking back
                  </>
                ) : (
                  <>
                    <Icon name="retry" size={16} />
                    Take back
                  </>
                )}
              </button>
              <button
                type="button"
                className="wl-soft"
                onClick={() => {
                  setMade(null);
                  setDir("u");
                  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-v="send"] input')?.focus({ preventScroll: true }));
                }}
              >
                Done
              </button>
            </div>
          }
        />
      );
    } else {
      const over = n > have;
      const o = over ? mint.coverBy(n) : null;
      const sum = tokens.reduce((a, x) => a + satsOf(x.amount, x.unit), 0);
      body = (
        <Pane
          dir={dir}
          fill={
            <>
              <div className="wl-amtset">
                <Amount
                  value={s.sendAmount}
                  onChange={(v) => s.setSendAmount(v)}
                  onEnter={() => void make()}
                  bump={bump}
                  fieldRef={field}
                  warn={over}
                  buys={
                    over ? (
                      <Two a={`Only ${fmt(have)} sats on ${mn}`} b={o ? `${o.name} has ${fmt(o.bal)}. Switch mint below.` : undefined} />
                    ) : n <= 0 ? (
                      <Two a={`You have ${fmt(have)} sats on ${mn}`} />
                    ) : n === have ? (
                      <Two a={`That is everything on ${mn}`} />
                    ) : (
                      <Two a={`${fmt(have - n)} sats stay on ${mn}`} />
                    )
                  }
                />
                <Picks
                  list={[
                    [100, "100"],
                    [500, "500"],
                    [have, "All", `All ${fmt(have)} sats on ${mn}`],
                  ]}
                  value={n}
                  onPick={(p) => {
                    s.setSendAmount(p > 0 ? String(p) : "");
                    setBump((b) => b + 1);
                  }}
                />
              </div>
              {tokens.length > 0 && (
                <button type="button" className="wl-row wl-out" onClick={toTokens}>
                  <span className="wl-row-t">
                    <span>{tokens.length === 1 ? "1 token" : `${tokens.length} tokens`} not claimed yet</span>
                  </span>
                  <span className="wl-row-s">{fmt(sum)} sats you can still take back</span>
                  <span className="wl-row-r">
                    <Icon name="right" size={14} className="wl-chev" />
                  </span>
                </button>
              )}
            </>
          }
          main={
            <button
              type="button"
              className="wl-go"
              data-busy={s.isGeneratingSendToken ? "" : undefined}
              disabled={s.isGeneratingSendToken || !(n > 0 && n <= have)}
              onClick={() => void make()}
            >
              {s.isGeneratingSendToken ? (
                <>
                  <Spin />
                  Making the token
                </>
              ) : (
                "Create token"
              )}
            </button>
          }
          after={
            note ? (
              <Note kind={note.kind} text={note.text} center />
            ) : s.error && !s.isGeneratingSendToken && !ln ? (
              <Note kind="warn" text="The token could not be made. Nothing left your wallet." center />
            ) : (
              <p className="wl-hint">A token is sats written as text. Send it in any chat.</p>
            )
          }
        />
      );
    }
  } else if (lnPaid !== null) {
    done = true;
    body = (
      <Pane
        dir="u"
        fill={
          lnPaid.pending ? (
            <Done title={`Sending ${fmt(lnPaid.n)} sats`} line="On its way. It settles when the network confirms, and any fee left over comes back then." />
          ) : (
            <Done title={`Paid ${fmt(lnPaid.n)} sats`} line="Any fee left over came back to you" />
          )
        }
        main={
          <button
            type="button"
            className="wl-soft"
            onClick={() => {
              setLnPaid(null);
              setDir("u");
            }}
          >
            <Icon name="paste" size={15} />
            Pay another invoice
          </button>
        }
      />
    );
  } else {
    const quoted = s.invoiceAmount !== null;
    const fee = s.invoiceFeeReserve ?? 0;
    const total = (s.invoiceAmount ?? 0) + fee;
    const paying = s.isNip60Processing;
    const failed = quoted && !!s.error && !paying;
    const short = quoted && !paying && total > have;
    const none = !!ln && /^ln(bc|tb|bcrt)/i.test(ln) && noAmount(ln);
    const notLn = !!ln && !/^ln(bc|tb|bcrt)/i.test(ln);
    let read_: React.ReactNode = <p className="wl-hint">You will see the amount and the fee before anything is paid.</p>;
    let main: React.ReactNode = (
      <button type="button" className="wl-go" disabled>
        Pay
      </button>
    );
    if (s.isNip60LoadingInvoice) {
      read_ = (
        <p className="wl-status" role="status">
          <Spin />
          Reading the invoice
        </p>
      );
    } else if (none) {
      read_ = (
        <div className="wl-read">
          <p className="wl-read-k">This invoice asks for</p>
          <p className="wl-read-n is-none">No amount</p>
          <Note kind="warn" center text="It leaves the amount to the payer, which this wallet cannot do yet. Ask for an invoice with the amount in it." />
        </div>
      );
      main = (
        <button type="button" className="wl-soft" onClick={() => cancel()}>
          <Icon name="paste" size={15} />
          Paste another invoice
        </button>
      );
    } else if (quoted) {
      const o = short ? mint.coverBy(total) : null;
      read_ = (
        <>
          <div className="wl-read">
            <p className="wl-read-k">This invoice asks for</p>
            <p className="wl-read-n">
              {fmt(s.invoiceAmount ?? 0)}
              <small>sats</small>
            </p>
            <div className="wl-sum">
              <div>
                <span>Network fee, at most</span>
                <span>{fmt(fee)}</span>
              </div>
              <div className="total">
                <span>Leaves your wallet, at most</span>
                <span>{fmt(total)}</span>
              </div>
            </div>
          </div>
          {short && (
            <Note kind="warn" text={`Not enough on ${mn}. It has ${fmt(have)} sats, this needs up to ${fmt(total)}.${o ? ` ${o.name} has ${fmt(o.bal)}, switch mint below.` : ""}`} />
          )}
          {failed && <Note kind="warn" text="This payment did not finish. Check the invoice is still unpaid before you try again." />}
        </>
      );
      main = (
        <div className="wl-two">
          <button type="button" className="wl-soft" disabled={paying} onClick={() => cancel()}>
            Cancel
          </button>
          {short ? (
            <button type="button" className="wl-go" onClick={toAdd}>
              <Icon name="arrowDown" size={16} />
              Add funds
            </button>
          ) : (
            <button
              type="button"
              className="wl-go"
              data-busy={paying ? "" : undefined}
              disabled={paying}
              // after a failure the old quote is gone: read the invoice again, so a
              // fresh quote and fee show before anything is paid
              onClick={
                failed
                  ? () => {
                      const t = ln;
                      cancel(false);
                      read(t);
                    }
                  : pay
              }
            >
              {paying ? (
                <>
                  <Spin />
                  Paying
                </>
              ) : failed ? (
                <>
                  <Icon name="retry" size={16} />
                  Try again
                </>
              ) : (
                `Pay ${fmt(s.invoiceAmount ?? 0)} sats`
              )}
            </button>
          )}
        </div>
      );
    } else if (ln && (s.error || notLn)) {
      read_ = <Note kind="warn" text={notLn ? "That is not a Lightning invoice. It should start with lnbc." : "That invoice could not be read. Check it, or pick another mint below."} />;
      main = (
        <button type="button" className="wl-soft" onClick={() => cancel()}>
          <Icon name="paste" size={15} />
          Paste another invoice
        </button>
      );
    }
    body = (
      <Pane
        cls="is-top"
        dir={dir}
        fill={
          <>
            {ln ? (
              <Pasted text={ln} label="Lightning invoice" onClear={paying ? undefined : cancel} />
            ) : (
              <div className="wl-paste">
                <textarea
                  id="wlLnIn"
                  rows={4}
                  spellCheck={false}
                  aria-label="Lightning invoice"
                  placeholder="Paste a Lightning invoice"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onPaste={(e) => {
                    const t = e.clipboardData.getData("text").trim();
                    if (!t) return;
                    e.preventDefault();
                    read(t);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !draft.trim()) return;
                    e.preventDefault();
                    read(draft);
                  }}
                />
                <button type="button" className="wl-link" onClick={() => void paste()}>
                  <Icon name="paste" size={15} />
                  Paste
                </button>
              </div>
            )}
            {read_}
          </>
        }
        main={main}
      />
    );
  }

  return (
    <>
      <Seg label="How to send" a="Lightning" b="Cashu token" i={tab} done={done} onPick={pick} />
      {body}
    </>
  );
}

/* ── the tokens out in the world, one level deeper ───────────────────────── */
export function Tokens({ say, onEmptyBack }: { say: (t: string) => void; onEmptyBack: () => void }) {
  const s = useWalletSend();
  const tokens = useUnclaimedTokensStore((x) => x.unclaimedTokens);
  const mint = useActiveMint();
  const { copied, copy } = useCopy(say);
  const [open, setOpen] = useState<string | null>(null);
  const [forget, setForget] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<{ kind: Kind; text: string; at: number; n: number } | null>(null);
  const list = [...tokens].sort((a, b) => b.createdAt - a.createdAt);

  // a note takes the place of the row it is about, then fades after four seconds
  const place = (id: string, kind: Kind, text: string) => {
    const at = list.findIndex((t) => t.id === id);
    const next = list[at + 1]?.id ?? list[at - 1]?.id ?? null;
    setGone((g) => new Set(g).add(id));
    setNote({ kind, text, at: Math.max(0, at), n: Date.now() });
    say(text);
    if (open === id) setOpen(null);
    setForget(null);
    window.setTimeout(() => {
      const el = next ? document.querySelector<HTMLElement>(`[data-fold="${next}"] .wl-row`) : null;
      if (el) el.focus({ preventScroll: true });
      else onEmptyBack();
    }, tokenMs("--d-mid") + 40);
  };
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote((x) => (x?.n === note.n ? null : x)), 4000);
    return () => window.clearTimeout(t);
  }, [note]);
  const takeBack = useTakeBack(s, (id, kind, text) => (kind === "warn" ? say(text) : place(id, kind, text)));

  const noteEl = note ? (
    <div className="wl-grow" key={`n${note.n}`}>
      <div>
        <Note kind={note.kind} text={note.text} />
      </div>
    </div>
  ) : null;
  if (!tokens.length) {
    return (
      <div className="wl-done quiet">
        <p className="wl-done-t">Nothing out right now</p>
        <p className="wl-done-s">Every token you made was claimed or taken back.</p>
        {noteEl}
      </div>
    );
  }
  const rows: React.ReactNode[] = list.map((t) => {
    const sats = satsOf(t.amount, t.unit);
    const isOpen = open === t.id;
    const busy = s.reclaimingTokenId === t.id;
    const m = mint.all.find((x) => x.url === t.mintUrl);
    return (
      <div className="wl-fold" key={t.id} data-fold={t.id} data-gone={gone.has(t.id) ? "" : undefined}>
        <div>
          <div className="wl-tok" data-open={isOpen ? "" : undefined}>
            <button
              type="button"
              className="wl-row"
              aria-expanded={isOpen}
              onClick={() => {
                setForget(null);
                setOpen(isOpen ? null : t.id);
              }}
            >
              <span className="wl-row-t">
                <span>{fmt(sats)} sats</span>
              </span>
              <span className="wl-row-s">
                Made {ago(t.createdAt)}
                {m ? ` on ${m.name}` : ""}
              </span>
              <span className="wl-row-r">
                <Icon name="right" size={14} className="wl-chev" />
              </span>
            </button>
            <div className="wl-tok-body">
              <div className="wl-tok-in" inert={!isOpen}>
                <div className="wl-tok-pad">
                  {forget === t.id ? (
                    <div className="wl-confirm" role="alertdialog" aria-label="Forget this token?">
                      <p>Forget this token?</p>
                      <p>Only if it was claimed. If nobody has it, these {fmt(sats)} sats are gone for good.</p>
                      <div className="wl-two">
                        <button type="button" className="wl-soft" autoFocus onClick={() => setForget(null)}>
                          Keep it
                        </button>
                        <button
                          type="button"
                          className="wl-soft danger"
                          onClick={() => {
                            s.dismissUnclaimedToken(t.id);
                            place(t.id, "ok", `Forgot the ${fmt(sats)} sat token.`);
                          }}
                        >
                          Forget
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Code value={t.token} printed copied={copied === t.id} label="Copy token" onCopy={() => void copy(t.token, t.id)} />
                      <div className="wl-two">
                        <button type="button" className="wl-soft" onClick={() => void copy(t.token, t.id)}>
                          <Icon name="copy" size={16} />
                          Copy
                        </button>
                        <button type="button" className="wl-soft" data-busy={busy ? "" : undefined} disabled={busy} onClick={() => takeBack(t)}>
                          {busy ? (
                            <>
                              <Spin />
                              Taking back
                            </>
                          ) : (
                            <>
                              <Icon name="retry" size={16} />
                              Take back
                            </>
                          )}
                        </button>
                      </div>
                      <button type="button" className="wl-textlink" onClick={() => setForget(t.id)}>
                        It was claimed, forget it
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  });
  if (noteEl) rows.splice(Math.min(note!.at, rows.length), 0, noteEl);
  return (
    <>
      <p className="wl-lede">Each of these is money someone can still claim. Until they do, you can take it back.</p>
      <div className="wl-sec" style={{ marginTop: "var(--s4)" }}>
        <p className="wl-sec-t">
          <span>Not claimed yet</span>
          <span>{fmt(tokens.reduce((a, t) => a + satsOf(t.amount, t.unit), 0))} sats</span>
        </p>
        <div className="wl-rows">{rows}</div>
      </div>
    </>
  );
}
