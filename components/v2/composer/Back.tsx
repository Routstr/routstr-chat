"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getDecodedToken } from "@cashu/cashu-ts";
import { ExtensionAccount, NostrConnectAccount, PrivateKeyAccount } from "applesauce-accounts/accounts";
import { NostrConnectSigner } from "applesauce-signers";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import { useAccountManager, type AccountMetadata } from "@/components/ClientProviders";
import { getRequiredSatsForModel } from "@/utils/modelUtils";
import { Icon, type IconName } from "../icons";
import { useUi } from "../ui";
import { useMoney } from "../useMoney";
import { useFunding } from "../wallet/useFunding";
import Qr from "./Qr";
import { tokenMs } from "../motion";

/* The back of the composer: add a few sats, or sign in. The words stay on the
   band above; this card beneath is a tone deeper and shows one thing at a
   time. Money only moves through useFunding (which calls the wallet's own
   hooks); this file sequences and describes. */

const PRESETS = [500, 1000, 5000];
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const nbsp = (s: string) => s.replace(/ ([^ ]+)$/, " $1"); // no lonely last word

const phoneNow = () => typeof window !== "undefined" && window.innerWidth <= 760;
const touch = () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Warn() {
  return (
    <svg className="v2-ico pa-wi" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.6M12 15.8v.01" />
    </svg>
  );
}

function Seal() {
  return (
    <span className="pa-seal" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="m5.5 12.6 4 4 9-9.2" pathLength={30} />
      </svg>
    </span>
  );
}

/** A button whose label can swap (Copy / Copied, Connect / Connecting)
 *  without ever changing width: both labels share one grid cell. */
function Swap({
  className,
  icon,
  idle,
  busy,
  on,
  onClick,
  disabled,
  mode = "busy",
}: {
  className: string;
  icon: IconName;
  idle: string;
  busy: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  mode?: "busy" | "copied";
}) {
  return (
    <button
      className={`${className} pa-swapb`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={on ? busy : idle}
      aria-busy={mode === "busy" ? on : undefined}
      data-on={on ? "" : undefined}
    >
      <span className="pa-swapc">
        <span className="pa-swap">
          <Icon name={icon} size={16} />
          {mode === "busy" ? <span className="spin-s" aria-hidden="true" /> : <Icon name="check" size={16} />}
        </span>
        <span className="pa-swapw" aria-hidden="true">
          <span>{idle}</span>
          <span>{busy}</span>
        </span>
      </span>
    </button>
  );
}

type Way = null | "ext" | "key" | "bunker";

export default function Back({
  face,
  island,
}: {
  face: "pay" | "auth";
  island: React.RefObject<HTMLDivElement | null>;
}) {
  const { selectedModel } = useChat();
  const { isAuthenticated } = useAuth();
  const ui = useUi();
  const money = useMoney();
  const funding = useFunding();
  const { manager, manualSave } = useAccountManager();
  const phone = phoneNow();

  /* ── where things stand ─────────────────────────────────────────────── */
  const [method, setMethod] = useState<"ln" | "token">("ln");
  const [picked, setPicked] = useState(0);
  const [other, setOther] = useState("");
  const [copied, setCopied] = useState(false);
  const [tokText, setTokText] = useState("");
  const [tokFail, setTokFail] = useState(false);
  const [landed, setLanded] = useState(0);
  const [from] = useState<"pay" | "write">(() => (ui.sendWhenFunded ? "pay" : face === "auth" ? "write" : "pay"));
  const [way, setWay] = useState<Way>(null);
  const [wayState, setWayState] = useState<"" | "busy" | "bad" | "late">("");
  const [keyText, setKeyText] = useState("");
  const [bunkerText, setBunkerText] = useState("");
  const [scan, setScan] = useState<string | null>(null);
  const [done, setDone] = useState<null | "in" | "new">(null);
  const live = useRef<HTMLParagraphElement>(null);
  const say = useCallback((t: string) => {
    const el = live.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => (el.textContent = t));
  }, []);

  const balance = money.total;
  const need = selectedModel ? Math.ceil(getRequiredSatsForModel(selectedModel) || 0) : 0;
  const minOther = Math.max(1, need - balance);
  // an invoice runs out at the mint's deadline; after that nobody should pay it
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    const at = funding.expiresAt;
    if (!at || funding.status !== "waiting") return;
    const t = window.setTimeout(() => setExpired(true), Math.max(0, at - Date.now()));
    return () => window.clearTimeout(t);
  }, [funding.expiresAt, funding.status]);
  const ln =
    funding.status === "creating"
      ? "making"
      : funding.status === "waiting"
        ? expired
          ? "stale"
          : "waiting"
        : funding.status === "paid" && method === "ln" && !landed
          ? "paid"
          : funding.status === "error" && funding.amount > 0
            ? "error"
            : "pick";

  // a token pasted: read before receiving, so you see what and from where
  const read = useMemo(() => {
    const t = tokText.trim();
    if (!t) return { kind: "empty" as const };
    if (/^cashu[AB]/.test(t)) {
      try {
        const d = getDecodedToken(t);
        const total = d.proofs.reduce((s, p) => s + p.amount, 0);
        const sats = d.unit === "msat" ? Math.floor(total / 1000) : total;
        let host = d.mint;
        try {
          host = new URL(d.mint).host;
        } catch {
          // keep the raw mint text
        }
        return { kind: "read" as const, sats, host };
      } catch {
        // falls through to junk once it is long enough to judge
      }
    }
    if ("cashu".startsWith(t.slice(0, 5).toLowerCase()) && t.length < 12) return { kind: "empty" as const };
    return { kind: "junk" as const };
  }, [tokText]);
  const tok = landed
    ? "paid"
    : funding.tokenBusy
      ? "receiving"
      : tokFail && read.kind === "read"
        ? "error"
        : read.kind;

  const view: "pick" | "inv" | "tok" | "landed" | "auth" | "done" =
    face === "auth" ? (done ? "done" : "auth") : method === "token" ? (tok === "paid" ? "landed" : "tok") : ln === "pick" ? "pick" : "inv";

  /* ── money landed: the seal, the balance rises, the words send ──────── */
  const paidOnce = useRef(false);
  useEffect(() => {
    if (funding.status !== "paid" || paidOnce.current) return;
    paidOnce.current = true;
    say(`Received ${fmt(funding.amount)} sats.${ui.sendWhenFunded ? " Sending your message." : ""}`);
  }, [funding.status, funding.amount, ui.sendWhenFunded, say]);
  // with no held message, the card turns back by itself once the seal has shown
  // (a held one is sent by the composer, which turns the card back itself)
  const { setFace } = ui;
  const holding = ui.sendWhenFunded;
  const settled = funding.status === "paid" || !!landed;
  useEffect(() => {
    if (!settled || holding) return;
    const t = window.setTimeout(() => setFace("write"), 1500);
    return () => window.clearTimeout(t);
  }, [settled, holding, setFace]);
  // a token that covered only part of what the held message needs: after the
  // seal the card goes back to the amounts, whose head says what is still short
  const short = useRef(false);
  short.current = need > 0 && balance < need;
  useEffect(() => {
    if (!landed || !holding) return;
    const t = window.setTimeout(() => {
      if (!short.current) return;
      setLanded(0);
      setTokText("");
      setMethod("ln");
      say(`That covered part of it. Add about ${fmt(Math.max(1, need - balance))} more sats to send.`);
    }, 1700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed, holding]);

  /* ── actions ────────────────────────────────────────────────────────── */
  const makeInvoice = (n: number, fromEl?: HTMLElement | null) => {
    setPicked(n);
    setCopied(false);
    // the tapped number flies into the headline
    const fr = fromEl?.getBoundingClientRect();
    funding.createInvoice(n);
    say(`Making an invoice for ${fmt(n)} sats`);
    if (!fr || reduced()) return;
    requestAnimationFrame(() => {
      const to = document.querySelector<HTMLElement>(".pa-inv .pa-amount-n");
      if (!to) return;
      const tr = to.getBoundingClientRect();
      const s = fr.height / tr.height;
      to.animate([{ transform: `translate(${fr.left - tr.left}px, ${fr.bottom - tr.bottom}px) scale(${s})` }, { transform: "none" }], {
        duration: 380,
        easing: "cubic-bezier(.22, 1.02, .32, 1)",
      });
    });
  };

  useEffect(() => {
    if (funding.status === "waiting") say(`Invoice ready for ${fmt(funding.amount)} sats. Waiting for payment.`);
  }, [funding.status, funding.amount, say]);

  const copyInvoice = async () => {
    if (!funding.invoice) return;
    try {
      await navigator.clipboard.writeText(funding.invoice);
      setCopied(true);
      say("Invoice copied");
    } catch {
      // clipboard refused: nothing was copied, so nothing is claimed
    }
  };
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const changeAmount = () => {
    funding.reset();
    paidOnce.current = false;
  };


  const receive = async () => {
    if (read.kind !== "read" || funding.tokenBusy) return;
    setTokFail(false);
    const got = await funding.redeemToken(tokText);
    if (got < 0) return; // a second press while the first swap runs
    if (got) setLanded(got);
    else setTokFail(true);
  };

  const pasteInto = async (set: (v: string) => void, focusSel: string) => {
    try {
      set((await navigator.clipboard.readText()).trim());
    } catch {
      document.querySelector<HTMLElement>(focusSel)?.focus();
    }
  };

  /* ── sign in ────────────────────────────────────────────────────────── */
  const count = () => manager.accounts$.value.length + 1;
  const adopt = (account: Parameters<typeof manager.addAccount>[0], kind: "in" | "new", name?: string) => {
    if (name) account.metadata = { name } as AccountMetadata;
    manager.addAccount(account);
    manager.setActive(account);
    manualSave.next();
    setWay(null);
    setWayState("");
    setDone(kind);
    say(kind === "new" ? "A new key was made on this device." : "Signed in.");
  };
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => {
      setDone(null);
      ui.setFace(from === "pay" || ui.sendWhenFunded ? "pay" : "write");
    }, 1700);
    return () => window.clearTimeout(t);
  }, [done, from, ui]);

  const extension = async () => {
    setWay("ext");
    setWayState("busy");
    try {
      adopt((await ExtensionAccount.fromExtension()) as never, "in");
    } catch {
      setWayState("bad");
    }
  };
  const nsecOk = (v: string) => /^nsec1[02-9ac-hj-np-z]{58}$/.test(v) || /^[0-9a-f]{64}$/i.test(v);
  const withKey = () => {
    const v = keyText.trim();
    if (!v) return;
    if (!nsecOk(v)) {
      setWayState("bad");
      return;
    }
    try {
      adopt(PrivateKeyAccount.fromKey<AccountMetadata>(v) as never, "in", `Account ${count()}`);
      setKeyText("");
    } catch {
      setWayState("bad");
    }
  };
  const bunker = async () => {
    const v = bunkerText.trim();
    if (!v || wayState === "busy") return;
    setWayState("busy");
    try {
      const signer = await NostrConnectSigner.fromBunkerURI(v);
      const pubkey = await signer.getPublicKey();
      adopt(new NostrConnectAccount<AccountMetadata>(pubkey, signer) as never, "in", `Bunker ${count()}`);
      setBunkerText("");
    } catch {
      setWayState("bad");
    }
  };
  const scanRun = useRef(0);
  const startScan = async () => {
    const id = ++scanRun.current;
    setWayState("");
    const signer = new NostrConnectSigner({ relays: ["wss://relay.nsec.app"] });
    setScan(signer.getNostrConnectURI({ name: "Routstr Chat" }));
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 60_000);
    try {
      await signer.waitForSigner(ctrl.signal);
      if (id !== scanRun.current) return;
      const pubkey = await signer.getPublicKey();
      adopt(new NostrConnectAccount<AccountMetadata>(pubkey, signer) as never, "in", `Bunker ${count()}`);
      setScan(null);
    } catch {
      if (id === scanRun.current) setWayState("late");
    } finally {
      window.clearTimeout(timeout);
    }
  };
  const stopScan = () => {
    scanRun.current++;
    setScan(null);
    setWayState("");
  };
  const fresh = () => adopt(PrivateKeyAccount.generateNew<AccountMetadata>() as never, "new", `Account ${count()}`);
  const openWay = (w: Way) => {
    stopScan();
    setWayState("");
    setWay((cur) => (cur === w ? null : w));
    if (w && !touch()) window.setTimeout(() => document.querySelector<HTMLInputElement>(`.pa-way[data-way="${w}"] input`)?.focus(), 90);
  };
  const [hasExt, setHasExt] = useState(false);
  useEffect(() => setHasExt(!!(window as unknown as { nostr?: unknown }).nostr), []);

  // back goes up one level: an open way, then out of sign in
  const back = useCallback(() => {
    if (face === "auth" && way && way !== "ext") {
      stopScan();
      setWay(null);
      return;
    }
    if (face === "auth" && from === "pay") return ui.setFace("pay");
    ui.setSendWhenFunded(false);
    ui.setFace("write");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, way, from, ui]);

  // Esc does the same, from anywhere on the card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!island.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      e.preventDefault();
      back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, island]);

  /* ── the views ──────────────────────────────────────────────────────── */
  const head =
    isAuthenticated && balance > 0
      ? {
          t: "Top up to send",
          s: (
            <>
              You have <b>{fmt(balance)} sats</b>. This model needs <b>{fmt(need)} sats</b>{" "}to start a&nbsp;reply.
            </>
          ),
        }
      : {
          t: "Add a few sats to send",
          s: isAuthenticated
            ? "Your message waits right here and sends itself once they land."
            : "No account needed. Your message waits right here and sends itself once they land.",
        };
  const firstOk = PRESETS.find((n) => n + balance >= need);
  const otherN = Number(other || 0);

  const amtKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const all = Array.from(document.querySelectorAll<HTMLElement>(".pa-amt[data-n]:not([aria-disabled])"));
    const i = all.indexOf(e.currentTarget) + (e.key === "ArrowRight" ? 1 : -1);
    e.preventDefault();
    if (i >= all.length) return document.querySelector<HTMLInputElement>("#paOther")?.focus();
    all[Math.max(0, i)]?.focus();
  };

  let body: React.ReactNode = null;
  if (view === "pick") {
    body = (
      <div className="pa-view" data-view="pick" key="pick">
        <header className="pa-head">
          <h2 className="pa-t" id="paTitle">{head.t}</h2>
          <p className="pa-sub">{head.s}</p>
        </header>
        <div className="pa-pickbody">
          <div className="pa-amts" role="group" aria-labelledby="paTitle">
            {PRESETS.map((n) => {
              const low = n + balance < need;
              const stop = PRESETS.includes(picked) ? n === picked : n === firstOk;
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
  } else if (view === "inv") {
    const s = ln;
    const line =
      s === "making" ? (
        <>
          <span className="spin-s" aria-hidden="true" />
          Making an invoice
        </>
      ) : s === "paid" ? (
        <>
          <span className="pa-dot" aria-hidden="true" />
          Received
        </>
      ) : s === "error" ? (
        <>
          <Warn />
          The mint did not answer
        </>
      ) : s === "stale" ? (
        "This invoice ran out"
      ) : (
        <>
          <span className="pa-dot" aria-hidden="true" />
          Waiting for payment
        </>
      );
    const meta =
      s === "making"
        ? "Your message sends by itself once it is paid."
        : s === "paid"
          ? ui.sendWhenFunded
            ? "Sending your message now."
            : "It is in your balance."
          : s === "error"
            ? nbsp("Nothing was charged. Try again in a moment, or pick another mint in Settings.")
            : s === "stale"
              ? nbsp("Nothing was charged. Make a new one to carry on.")
              : funding.walletPaying
                ? nbsp("Your wallet is paying. Your message sends once it lands.")
                : funding.walletError
                  ? nbsp(`Your wallet could not pay: ${funding.walletError}. The invoice still works.`)
                  : funding.expiresAt
                    ? nbsp(`Scan with any Lightning wallet. Good until ${new Date(funding.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`)
                    : "Scan with any Lightning wallet.";
    let acts: React.ReactNode = null;
    if (s === "making" && phone) acts = <button className="pa-link" type="button" onClick={changeAmount}>Change amount</button>;
    if (s === "waiting")
      acts = phone ? (
        <button className="pa-link" type="button" onClick={changeAmount}>Change amount</button>
      ) : funding.walletConnected ? (
        <Swap className="soft" icon="copy" idle="Copy invoice" busy="Copied" on={copied} onClick={copyInvoice} mode="copied" />
      ) : (
        <button className="soft" type="button" onClick={() => void funding.payFromWallet()}>
          <Icon name="bolt" size={16} />
          Connect a wallet
        </button>
      );
    body = (
      <div className="pa-view" data-view="inv" key="inv">
        <div className="pa-inv" data-paid={s === "paid" ? "" : undefined} data-error={s === "error" ? "" : undefined}>
          <Qr
            value={funding.invoice || "lnbc"}
            state={s === "making" || s === "error" ? "making" : s === "waiting" ? "ready" : s === "stale" ? "stale" : "done"}
            label="Lightning invoice code"
            onCopy={copyInvoice}
          />
          <div className="pa-side">
            <p className="pa-amount" data-done={s === "paid" ? "" : undefined}>
              <span className="pa-amount-n">{fmt(funding.amount || picked)}</span>
              <span className="pa-u">sats</span>
            </p>
            <div className="pa-status">
              <p className="pa-line" data-tone={s === "paid" ? "done" : s === "error" ? "warn" : undefined}>{line}</p>
              <p className="pa-meta">{meta}</p>
            </div>
          </div>
          {acts && <div className="pa-acts">{acts}</div>}
        </div>
      </div>
    );
  } else if (view === "tok") {
    const sayTok =
      tok === "junk" ? (
        <>
          <Warn />
          That is not a Cashu token. Tokens start with <b>cashuA</b> or&nbsp;<b>cashuB</b>.
        </>
      ) : tok === "error" ? (
        <>
          <Warn />
          {/spent/i.test(funding.message) ? "Someone already spent this token. Nothing changed in your wallet." : "The token could not be received. Nothing changed in your wallet."}
        </>
      ) : tok === "receiving" ? (
        "Receiving from the mint."
      ) : tok === "read" ? (
        read.kind === "read" && need > 0 && balance + read.sats < need
          ? `This covers part of it. You will need about ${fmt(need - balance - read.sats)} more.`
          : "Ready to receive. Your message sends once it lands."
      ) : (
        <>
          Ecash someone sent you, as text that starts with <b>cashu</b>. It&nbsp;becomes your&nbsp;balance.
        </>
      );
    body = (
      <div className="pa-view" data-view="tok" key="tok">
        <header className="pa-head">
          <h2 className="pa-t">{head.t}</h2>
          <p className="pa-sub">{head.s}</p>
        </header>
        <div className="pa-mid">
          <div className="pa-tokbody">
            {read.kind === "read" ? (
              <div className="pa-tok-read" data-bad={tok === "error" ? "" : undefined}>
                <span className="pa-coin">
                  <Icon name={tok === "error" ? "close" : "coin"} size={20} />
                </span>
                <div className="pa-tok-t">
                  <p className="pa-amount">
                    <span className="pa-amount-n">{fmt(read.sats)}</span>
                    <span className="pa-u">sats</span>
                  </p>
                  <p className="pa-meta">
                    from <span className="pa-host">{read.host}</span>
                  </p>
                </div>
                <button
                  className="pa-link plain"
                  data-act="tok-clear"
                  type="button"
                  style={{ visibility: tok === "read" ? undefined : "hidden" }}
                  onClick={() => {
                    setTokText("");
                    setTokFail(false);
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="pa-tok" data-bad={tok === "junk" ? "" : undefined}>
                <textarea
                  id="paTokIn"
                  rows={3}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="cashuB…"
                  aria-label="Cashu token"
                  aria-describedby="paSay"
                  value={tokText}
                  onChange={(e) => {
                    setTokText(e.target.value);
                    setTokFail(false);
                  }}
                />
                {!tokText && (
                  <button className="soft pa-paste" type="button" onClick={() => void pasteInto(setTokText, "#paTokIn")}>
                    <Icon name="paste" size={16} />
                    Paste
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="pa-say" id="paSay" data-tone={tok === "junk" || tok === "error" ? "warn" : undefined}>
            {sayTok}
          </p>
        </div>
      </div>
    );
  } else if (view === "landed") {
    body = (
      <div className="pa-view" data-view="landed" key="landed">
        <div className="pa-inv" data-paid="" data-landed="">
          <div className="pa-slot">
            <Seal />
          </div>
          <div className="pa-side">
            <p className="pa-amount" data-done="">
              <span className="pa-amount-n">{fmt(landed)}</span>
              <span className="pa-u">sats</span>
            </p>
            <div className="pa-status">
              <p className="pa-line" data-tone="done">
                <span className="pa-dot" aria-hidden="true" />
                Received
              </p>
              <p className="pa-meta">{ui.sendWhenFunded ? "Sending your message now." : "It is in your balance."}</p>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (view === "done") {
    body = (
      <div className="pa-view" data-view="done" key="done">
        <div className="pa-done" role="status">
          <Seal />
          <h2 className="pa-t">{done === "new" ? "A key of your own" : "You are in"}</h2>
          <p className="pa-sub">
            {done === "new" ? "It lives on this device. Back it up in Settings, Account, whenever you like." : "Your chats will follow this key, encrypted."}
          </p>
        </div>
      </div>
    );
  } else {
    const anyOpen = !!way && way !== "ext";
    const scanning = way === "bunker" && !!scan;
    const ways: { w: Exclude<Way, null>; icon: IconName; t: string; s: string; m: string }[] = [
      ...(hasExt ? [{ w: "ext" as const, icon: "key" as IconName, t: "Browser extension", s: "Alby, nos2x and the like.", m: "Alby, nos2x and the like." }] : []),
      { w: "key", icon: "shield", t: "Secret key", s: "Paste your nsec. It never leaves this device.", m: "Paste your nsec. It stays here." },
      { w: "bunker", icon: "link", t: "Remote signer", s: "Your key stays in a signer app, like Amber.", m: "Your key stays in an app like Amber." },
    ];
    const npub = /^npub1/.test(keyText.trim());
    body = (
      <div className="pa-view" data-view="auth" key="auth" data-open={anyOpen ? "" : undefined} data-scan={scanning ? "" : undefined}>
        <header className="pa-head">
          <div className="pa-head-row">
            <button className="ghost pa-back" type="button" onClick={back} aria-label={anyOpen ? "Back to every way in" : from === "pay" ? "Back to adding sats" : "Back to your message"}>
              <Icon name="back" size={18} />
            </button>
            <h2 className="pa-t" id="paAuthT">Sign in</h2>
          </div>
          <div className="pa-fold" data-folded={scanning ? "" : undefined}>
            <div>
              <p className="pa-sub">A private Nostr key you own, no email. Your chats sync,&nbsp;encrypted.</p>
            </div>
          </div>
        </header>
        <div className="pa-mid">
          <div className="pa-ways" role="group" aria-labelledby="paAuthT">
            {ways.map(({ w, icon, t, s, m }) => {
              const open = way === w && w !== "ext";
              const fold = anyOpen && way !== w;
              const busy = w === "ext" && way === "ext" && wayState === "busy";
              const no = w === "ext" && way === "ext" && wayState === "bad";
              return (
                <div className="pa-fold pa-wayfold" key={w} data-folded={fold ? "" : undefined} inert={fold}>
                  <div>
                    <div className="pa-way" data-way={w} data-open={open ? "" : undefined} data-busy={busy ? "" : undefined} data-bad={no ? "" : undefined}>
                      <div className="pa-fold pa-rowfold" data-folded={scanning && w === "bunker" ? "" : undefined} inert={scanning && w === "bunker"}>
                        <div>
                          <button
                            className="pa-row"
                            type="button"
                            aria-expanded={w === "ext" ? undefined : open}
                            aria-busy={busy || undefined}
                            onClick={() => (w === "ext" ? void extension() : openWay(w))}
                          >
                            <span className="pa-ic">
                              <Icon name={icon} />
                              <span className="spin-s" aria-hidden="true" />
                            </span>
                            <span className="pa-row-t">
                              <b>{t}</b>
                              <span className="pa-fold" data-folded={anyOpen ? "" : undefined}>
                                <span>
                                  {busy ? (
                                    "Approve the request in your extension."
                                  ) : no ? (
                                    <>
                                      <Warn />
                                      The extension said no. Try again, or use another&nbsp;way.
                                    </>
                                  ) : (
                                    <>
                                      <span className="pa-long">{s}</span>
                                      <span className="pa-short">{m}</span>
                                    </>
                                  )}
                                </span>
                              </span>
                            </span>
                            <span className="pa-end">
                              <Icon name="right" size={16} className="pa-chev" />
                            </span>
                          </button>
                        </div>
                      </div>
                      {w !== "ext" && (
                        <div className="pa-open">
                          <div>
                            <div className="pa-open-in">
                              {open && w === "key" && (
                                <>
                                  <div className="pa-form">
                                    <div className="pa-in" data-bad={wayState === "bad" ? "" : undefined}>
                                      <input
                                        type="password"
                                        autoComplete="off"
                                        spellCheck={false}
                                        placeholder="nsec1…"
                                        aria-label="Secret key"
                                        aria-describedby="paKeyH"
                                        value={keyText}
                                        onChange={(e) => {
                                          setKeyText(e.target.value.trim());
                                          setWayState("");
                                        }}
                                        onKeyDown={(e) => e.key === "Enter" && withKey()}
                                      />
                                      <button className="ghost" type="button" aria-label="Paste" title="Paste" onClick={() => void pasteInto(setKeyText, ".pa-way[data-way=key] input")}>
                                        <Icon name="paste" size={16} />
                                      </button>
                                    </div>
                                    <button className="prime" type="button" onClick={withKey} disabled={!keyText} data-hold={wayState === "bad" ? "" : undefined}>
                                      Sign in
                                    </button>
                                  </div>
                                  <p className="pa-hint" id="paKeyH" data-tone={wayState === "bad" ? "warn" : undefined}>
                                    {wayState !== "bad" ? (
                                      "Starts with nsec1. It never leaves this device."
                                    ) : npub ? (
                                      <>
                                        <Warn />
                                        <span>That is your public key, the one you share. Paste the secret one, it starts with&nbsp;nsec1.</span>
                                      </>
                                    ) : (
                                      <>
                                        <Warn />
                                        <span>That is not a secret key. It starts with nsec1 and runs 63&nbsp;characters.</span>
                                      </>
                                    )}
                                  </p>
                                </>
                              )}
                              {open && w === "bunker" && !scan && (
                                <>
                                  <div className="pa-form">
                                    <div className="pa-in" data-bad={wayState === "bad" ? "" : undefined}>
                                      <input
                                        autoComplete="off"
                                        spellCheck={false}
                                        placeholder="bunker://…"
                                        aria-label="Signer link"
                                        aria-describedby="paBunkerH"
                                        readOnly={wayState === "busy"}
                                        value={bunkerText}
                                        onChange={(e) => {
                                          setBunkerText(e.target.value.trim());
                                          setWayState("");
                                        }}
                                        onKeyDown={(e) => e.key === "Enter" && void bunker()}
                                      />
                                      <button className="ghost" type="button" aria-label="Paste" title="Paste" onClick={() => void pasteInto(setBunkerText, ".pa-way[data-way=bunker] input")}>
                                        <Icon name="paste" size={16} />
                                      </button>
                                    </div>
                                    <Swap className="prime" icon="link" idle="Connect" busy="Connecting" on={wayState === "busy"} onClick={() => void bunker()} disabled={!bunkerText} />
                                  </div>
                                  <p className="pa-hint" id="paBunkerH" data-tone={wayState === "bad" ? "warn" : undefined}>
                                    {wayState === "busy" ? (
                                      "Approve the request in your signer app."
                                    ) : wayState === "bad" ? (
                                      <>
                                        <Warn />
                                        <span>The signer did not answer. Check the link, then try&nbsp;again.</span>
                                      </>
                                    ) : (
                                      <>
                                        Paste the bunker link your signer app gives you.{" "}
                                        <button className="pa-link" type="button" onClick={() => void startScan()}>
                                          Or scan a code instead
                                        </button>
                                      </>
                                    )}
                                  </p>
                                </>
                              )}
                              {open && w === "bunker" && scan && (
                                <div className="pa-inv pa-connect">
                                  <Qr value={scan} state={wayState === "late" ? "stale" : "ready"} label="Code for your signer app" />
                                  <div className="pa-side">
                                    <div className="pa-status">
                                      <p className="pa-line" data-tone={wayState === "late" ? "warn" : undefined}>
                                        {wayState === "late" ? (
                                          <>
                                            <Warn />
                                            No answer yet
                                          </>
                                        ) : (
                                          <>
                                            <span className="pa-dot" aria-hidden="true" />
                                            Waiting for your signer
                                          </>
                                        )}
                                      </p>
                                      <p className="pa-meta">
                                        {wayState === "late"
                                          ? "Codes last a minute. Make a new one when you are ready."
                                          : phone
                                            ? "Open your signer app here, or scan this from another phone."
                                            : "Scan it with your signer app, then approve the request."}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="pa-acts" data-pair={phone ? "" : undefined}>
                                    {phone ? (
                                      <>
                                        <button className="soft" type="button" onClick={stopScan}>
                                          <Icon name="link" size={16} />
                                          Paste a link
                                        </button>
                                        {wayState === "late" ? (
                                          <button className="prime" type="button" onClick={() => void startScan()}>
                                            <Icon name="retry" size={16} />
                                            New code
                                          </button>
                                        ) : (
                                          <a className="prime" href={scan}>
                                            <Icon name="link" size={16} />
                                            Open app
                                          </a>
                                        )}
                                      </>
                                    ) : (
                                      <>
                                        {wayState === "late" ? (
                                          <button className="soft" type="button" onClick={() => void startScan()}>
                                            <Icon name="retry" size={16} />
                                            New code
                                          </button>
                                        ) : (
                                          <button className="soft" type="button" onClick={() => void navigator.clipboard?.writeText(scan).catch(() => {})}>
                                            <Icon name="copy" size={16} />
                                            Copy link
                                          </button>
                                        )}
                                        <button className="pa-link" type="button" onClick={stopScan}>
                                          Paste a link
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="pa-fold" data-folded={anyOpen ? "" : undefined} inert={anyOpen}>
              <div>
                <p className="pa-or" aria-hidden="true">or</p>
                <div className="pa-way" data-way="new">
                  <button className="pa-row" type="button" onClick={fresh}>
                    <span className="pa-ic">
                      <Icon name="plus" />
                    </span>
                    <span className="pa-row-t">
                      <b>Make a new key</b>
                      <span className="pa-fold">
                        <span>
                          <span className="pa-long">Start fresh on this device. Back it up whenever you&nbsp;like.</span>
                          <span className="pa-short">Start fresh. Back it up later.</span>
                        </span>
                      </span>
                    </span>
                    <Icon name="right" size={16} className="pa-chev" />
                  </button>
                </div>
              </div>
            </div>
            <div className="pa-fold" data-folded={!anyOpen ? "" : undefined} inert={!anyOpen}>
              <div>
                <p className="pa-alt">
                  <button className="pa-link" type="button" onClick={fresh}>
                    No key yet? Make a new one
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── the foot: how to pay on the left, the next step on the right ──── */
  let lead: React.ReactNode = null;
  let corner: React.ReactNode = null;
  const showSwitch = view === "pick" || view === "tok";
  if (view === "pick") {
    if (other && otherN >= minOther)
      corner = (
        <button className="prime" type="button" onClick={() => makeInvoice(otherN, document.querySelector<HTMLElement>("#paOther"))}>
          Get invoice
        </button>
      );
    else if (!isAuthenticated)
      corner = (
        <button className="pa-link" type="button" onClick={() => ui.setFace("auth")}>
          <span className="pa-long">Have a key? </span>Sign in
        </button>
      );
  } else if (view === "inv") {
    const payBtn = (label: string) => (
      <Swap className="prime" icon="bolt" idle={label} busy="Paying" on={funding.walletPaying} onClick={() => void funding.payFromWallet()} />
    );
    if (ln === "waiting") {
      if (phone) {
        lead = <Swap className="soft" icon="copy" idle="Copy invoice" busy="Copied" on={copied} onClick={copyInvoice} mode="copied" />;
        corner = funding.walletConnected ? (
          payBtn("Pay from wallet")
        ) : (
          <a className="prime" href={`lightning:${(funding.invoice || "").toLowerCase()}`}>
            <Icon name="bolt" size={16} />
            Open wallet
          </a>
        );
      } else {
        lead = (
          <button className="pa-link" type="button" onClick={changeAmount}>
            Change amount
          </button>
        );
        corner = funding.walletConnected ? payBtn("Pay from your wallet") : <Swap className="prime" icon="copy" idle="Copy invoice" busy="Copied" on={copied} onClick={copyInvoice} mode="copied" />;
      }
    } else if (ln === "making") {
      if (!phone)
        lead = (
          <button className="pa-link" type="button" onClick={changeAmount}>
            Change amount
          </button>
        );
    } else if (ln === "stale") {
      lead = (
        <button className="pa-link" type="button" onClick={changeAmount}>
          Change amount
        </button>
      );
      corner = (
        <button className="prime" type="button" onClick={() => makeInvoice(funding.amount)}>
          New invoice
        </button>
      );
    } else if (ln === "error") {
      lead = (
        <button className="pa-link" type="button" onClick={changeAmount}>
          Change amount
        </button>
      );
      corner = (
        <button className="prime" type="button" onClick={() => makeInvoice(funding.amount)}>
          <Icon name="retry" size={16} />
          Try again
        </button>
      );
    }
  } else if (view === "tok") {
    corner =
      tok === "error" ? (
        <button
          className="soft"
          type="button"
          onClick={() => {
            setTokText("");
            setTokFail(false);
          }}
        >
          <Icon name="paste" size={16} />
          Paste another
        </button>
      ) : (
        <Swap
          className="prime"
          icon="download"
          idle={read.kind === "read" && !phone ? `Receive ${fmt(read.sats)} sats` : "Receive"}
          busy="Receiving"
          on={tok === "receiving"}
          onClick={() => void receive()}
          disabled={!(tok === "read" || tok === "receiving")}
        />
      );
  }
  const footHidden = face === "auth" || view === "landed" || (view === "inv" && !lead && !corner);
  const pair = view === "inv" && phone && ln === "waiting";
  const solo = showSwitch && !lead && !corner;

  /* ── height: the card follows its content, gliding; it never pushes the words ── */
  const morph = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const measure = useCallback(
    (instant: boolean) => {
      const m = morph.current;
      const st = stage.current;
      const isl = island.current;
      if (!m || !st || !isl) return;
      const viewEl = st.querySelector<HTMLElement>(".pa-cur > .pa-view");
      let h: number;
      if (phoneNow()) h = m.querySelector<HTMLElement>(".pa-inwrap")?.offsetHeight ?? 0;
      else {
        const natural = (viewEl?.offsetHeight ?? 0) + (foot.current && !footHidden ? foot.current.offsetHeight : 0);
        // the card may grow down only to the panel's floor (a new chat) or keep the
        // thread's last 160px (docked); past that the view scrolls inside
        const ir = isl.getBoundingClientRect();
        const mr = m.getBoundingClientRect();
        const panel = isl.closest(".panel");
        const pr = panel?.getBoundingClientRect();
        const centred = isl.dataset.place === "centre";
        const tw = panel?.querySelector(".thread-wrap")?.getBoundingClientRect();
        const room = centred && pr ? pr.bottom - 28 - mr.top : tw ? ir.bottom - (tw.top + 160) - (mr.top - ir.top) - 20 : natural;
        h = Math.min(natural, Math.max(160, Math.floor(room)));
      }
      if (instant) {
        m.style.transition = "none";
        m.style.setProperty("--pa-h", `${h}px`);
        void m.offsetHeight;
        m.style.transition = "";
      } else m.style.setProperty("--pa-h", `${h}px`);
    },
    [island, footHidden]
  );
  const firstMeasure = useRef(true);
  useLayoutEffect(() => {
    measure(firstMeasure.current);
    firstMeasure.current = false;
  });
  useEffect(() => {
    const ro = new ResizeObserver(() => measure(false));
    if (stage.current) ro.observe(stage.current);
    if (foot.current) ro.observe(foot.current);
    stage.current?.querySelectorAll(".pa-view").forEach((v) => ro.observe(v));
    return () => ro.disconnect();
  }, [measure, view]);

  // the view that arrives takes no clicks until it has landed, so a double
  // click on the way in never lands on a row that slid under the pointer
  const [arriving, setArriving] = useState(false);
  const arrivingT = useRef(0);
  const lastKey = useRef(view);
  useLayoutEffect(() => {
    if (lastKey.current === view) return;
    lastKey.current = view;
    setArriving(true);
    window.clearTimeout(arrivingT.current);
    arrivingT.current = window.setTimeout(() => setArriving(false), 360);
  }, [view]);
  useEffect(() => () => window.clearTimeout(arrivingT.current), []);
  // the view that leaves fades up and out while the new one arrives
  const [leaving, setLeaving] = useState<{ key: string; node: React.ReactNode } | null>(null);
  const lastView = useRef<{ key: string; node: React.ReactNode }>({ key: view, node: body });
  const leaveT = useRef(0);
  useLayoutEffect(() => {
    if (lastView.current.key !== view && !reduced()) {
      setLeaving(lastView.current);
      window.clearTimeout(leaveT.current);
      leaveT.current = window.setTimeout(() => setLeaving(null), 130);
    }
    lastView.current = { key: view, node: body };
  });
  useEffect(() => () => window.clearTimeout(leaveT.current), []);

  // focus the first useful thing once the card has turned, and again when a
  // view swap took the focused control away (never on touch)
  const firstFocus = useRef(true);
  const spot = `${face}:${view}:${tok === "error"}:${ln === "stale"}`;
  useEffect(() => {
    if (touch()) return;
    const turned = firstFocus.current;
    firstFocus.current = false;
    const t = window.setTimeout(() => {
      const a = document.activeElement;
      if (!turned && a && a !== document.body && a.isConnected && !a.closest(".pa-out")) return;
      const root = morph.current;
      const el =
        root?.querySelector<HTMLElement>('.pa-cur .pa-amt[data-picked], .pa-cur .pa-amt[tabindex="0"]:not([aria-disabled])') ??
        root?.querySelector<HTMLElement>(".pa-cur .pa-row, .pa-corner .prime:not(:disabled), .pa-corner .soft, .pa-cur textarea, .pa-cur input, .pa-acts .soft, .pa-lead .soft");
      el?.focus({ preventScroll: true });
    }, turned ? 440 : tokenMs("--d-mid"));
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot]);

  // errors are spoken as well as shown
  useEffect(() => {
    if (tok === "error") say(/spent/i.test(funding.message) ? "Someone already spent this token. Nothing changed in your wallet." : "The token could not be received. Nothing changed in your wallet.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tok]);
  useEffect(() => {
    if (ln === "error") say("The mint did not answer. Nothing was charged.");
    if (ln === "stale") say("This invoice ran out. Nothing was charged.");
  }, [ln, say]);

  // paid: seal and words close into one group, centred in the card
  useLayoutEffect(() => {
    const inv = stage.current?.querySelector<HTMLElement>(".pa-cur .pa-inv[data-paid]");
    if (!inv) return;
    const place = () => {
      if (phoneNow()) return inv.style.removeProperty("--pa-gx");
      const tile = inv.querySelector<HTMLElement>(".pa-qr, .pa-slot");
      const side = inv.querySelector<HTMLElement>(".pa-side");
      if (!tile || !side) return;
      const seal = parseFloat(getComputedStyle(inv).getPropertyValue("--pa-seal")) || 56;
      const gap = parseFloat(getComputedStyle(inv).columnGap) || 0;
      const r = document.createRange();
      const sideW = Math.max(
        ...Array.from(side.querySelectorAll(".pa-amount, .pa-line, .pa-meta"), (n) => {
          r.selectNodeContents(n);
          return r.getBoundingClientRect().width;
        })
      );
      const left = (tile.offsetWidth - seal) / 2;
      inv.style.setProperty("--pa-gx", `${Math.round((inv.clientWidth - (seal + gap + sideW)) / 2 - left)}px`);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [view, ln]);

  return (
    <div className="pa-card">
      <div className="pa-morph" ref={morph}>
        <div className="pa-inwrap">
          <div className="pa-stage" ref={stage}>
            {leaving && leaving.key !== view && (
              <div className="pa-out" aria-hidden="true" inert>
                {leaving.node}
              </div>
            )}
            <div className="pa-cur" data-in={leaving ? "" : undefined} data-arriving={arriving ? "" : undefined}>
              {body}
            </div>
          </div>
          <div className="pa-foot" ref={foot} hidden={footHidden} data-pair={pair ? "" : undefined} data-solo={solo ? "" : undefined}>
            {showSwitch && (
              <div className="pa-switch" role="radiogroup" aria-label="How to pay" data-m={method}>
                <span className="pa-thumb" aria-hidden="true" />
                {(["ln", "token"] as const).map((m) => (
                  <button
                    key={m}
                    className="pa-seg"
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    tabIndex={method === m ? 0 : -1}
                    onClick={() => setMethod(m)}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                      e.preventDefault();
                      const next = method === "ln" ? "token" : "ln";
                      setMethod(next);
                      requestAnimationFrame(() => document.querySelector<HTMLElement>(`.pa-seg[aria-checked="true"]`)?.focus());
                    }}
                  >
                    {m === "ln" ? "Lightning" : <>Cashu<span className="pa-long"> token</span></>}
                  </button>
                ))}
              </div>
            )}
            {lead && <div className="pa-lead">{lead}</div>}
            <div className="pa-corner">{corner}</div>
          </div>
        </div>
      </div>
      <p className="sr" aria-live="polite" ref={live} />
    </div>
  );
}
