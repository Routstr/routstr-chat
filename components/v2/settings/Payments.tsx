"use client";

import React, { useState } from "react";
import { useBitcoinConnectStatus } from "@/hooks/useBitcoinConnect";
import { useCashuToken } from "@/features/wallet/hooks/useCashuToken";
import { useMints } from "@/features/wallet/view";
import { loadAutoRefillNWCSettings, saveAutoRefillNWCSettings, type AutoRefillNWCSettings } from "@/utils/storageUtils";
import { Icon } from "../icons";
import { useUi } from "../ui";
import { useMoney } from "../useMoney";
import { usePhone } from "../phone";
import { usePerReply } from "../wallet/Wallet";
import { Btn, Fold, Grp, Head, Ib, Row, Say, Sw, hostOf, n0, plural, useToast } from "./parts";
import { satUnit } from "../format";

/* Where your sats are, how each reply is paid, and where top-ups come from.
   Mints are added, checked and removed through the wallet's own hooks
   (useCashuToken); removing a mint forgets it here, its sats stay at the mint. */

export default function Payments() {
  const ui = useUi();
  const phone = usePhone();
  const money = useMoney();
  const { per, name } = usePerReply();
  const toast = useToast();

  /* ── Lightning: a connected wallet, and topping up by itself ───────────── */
  const nwc = useBitcoinConnectStatus();
  const [refill, setRefill] = useState<AutoRefillNWCSettings>(loadAutoRefillNWCSettings);
  const [nwcOff, setNwcOff] = useState(false);
  const updateRefill = (u: Partial<AutoRefillNWCSettings>) => {
    const next = { ...refill, ...u };
    setRefill(next);
    saveAutoRefillNWCSettings(next);
  };
  const conn = nwc.status === "connected";
  // main's key, read as the root reads it: "x-cashu" pays each reply with a token, anything else through an API key
  const [perRequest] = useState(() => {
    try {
      return window.localStorage.getItem("spendMode")?.replace(/"/g, "") === "x-cashu";
    } catch {
      return false;
    }
  });

  /* ── mints ─────────────────────────────────────────────────────────────── */
  // the wallet's own list: its event's mints, main's list once, and every mint holding a coin
  const cashu = useMints();
  const { addMintIfNotExists, removeMint, cleanSpentProofs } = useCashuToken();
  const urls = cashu.mints.map((m) => m.url);
  const mints = urls.map((url) => ({ url, bal: money.balances[url] ?? 0 }));
  const tot = mints.reduce((a, x) => a + x.bal, 0) || 1;
  const [adding, setAdding] = useState(false);
  const [mintIn, setMintIn] = useState("");
  const [mintErr, setMintErr] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [rm, setRm] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState<string | null>(null);
  const addMint = async () => {
    const v = mintIn.trim();
    if (!/^https?:\/\/[^\s]+/i.test(v)) return setMintErr("That does not look like a mint address. It starts with https://");
    setAddBusy(true);
    setMintErr("");
    try {
      await addMintIfNotExists(v);
      setMintIn("");
      setAdding(false);
      toast(`Added ${hostOf(v)}`);
    } catch {
      setMintErr("Could not reach that mint. Check the address and try again.");
    } finally {
      setAddBusy(false);
    }
  };
  const removeIt = async (url: string) => {
    try {
      await removeMint(url);
      if (cashu.activeMintUrl === url) {
        const rest = urls.filter((u) => u !== url);
        if (rest.length) cashu.setActiveMintUrl(rest[0]);
      }
      toast(`Removed ${hostOf(url)}`);
    } catch {
      toast("That mint could not be removed just now");
    } finally {
      setRm(null);
    }
  };
  const clean = async (url: string) => {
    setCleaning(url);
    try {
      const spent = await cleanSpentProofs(url);
      toast(spent.length ? `Removed ecash already spent at ${hostOf(url)}` : `Nothing spent at ${hostOf(url)}`);
    } catch {
      toast("The mint did not answer. Nothing changed.");
    } finally {
      setCleaning(null);
    }
  };
  const rmMint = rm ? mints.find((x) => x.url === rm) : null;

  return (
    <>
      <Head title="Payments" />
      <Grp id="g-balance" k="Balance">
        <div className="st-row st-balrow">
          <div className="st-txt">
            <div className="st-hero">
              <span className="st-hero-v">{n0(money.total)}</span>
              <span className="st-hero-u">{satUnit(money.total)}</span>
            </div>
            <p className="st-rn">
              {money.node
                ? "Your node pays for chats right now, so this stays untouched."
                : per > 0 && money.total >= per
                  ? <>On this device. About {plural(Math.floor(money.total / per), "reply", "replies")} with <span className="nobr">{name}</span>.</>
                  : per > 0
                    ? <>On this device. Not enough for a reply with <span className="nobr">{name}</span> yet.</>
                    : "On this device."}
            </p>
          </div>
          <div className="st-ctl">
            <Btn
              icon="wallet"
              onClick={() => {
                ui.closeSettings();
                ui.setSide("wallet");
              }}
            >
              Open wallet
            </Btn>
          </div>
        </div>
      </Grp>

      <Grp id="g-paying" k="Paying">
        {/* the way replies are paid on this device: the drawing says it, with no made-up numbers */}
        <div className="st-block">
          <div className="st-payhead">
            <p className="st-rt">How replies are paid</p>
            <p className="st-payv">{money.node ? "Your node" : perRequest ? "Per request" : "API key"}</p>
          </div>
          {!money.node && (
            <div className="st-flow" data-mode={perRequest ? "x-cashu" : "api-key"} aria-hidden="true">
              <span className="st-flow-end">You</span>
              <span className="st-lanes">
                <span className="st-lane out" data-k="solid">
                  <em>{perRequest ? "ecash for the reply" : "sats to a key"}</em>
                  <i className="st-run" />
                </span>
                <span className="st-lane back" data-k={perRequest ? "solid" : "dash"}>
                  <em>{perRequest ? "change back" : "change on Return"}</em>
                  <i className="st-run" />
                </span>
              </span>
              <span className="st-flow-end">Provider</span>
            </div>
          )}
          <p className="st-seg-note">
            {money.node
              ? "Your routstrd node pays for replies from its own wallet. This wallet is not used."
              : perRequest
                ? "Each message carries its own ecash and the change comes back to your wallet."
                : "Sats go to a key at the provider. What replies do not use waits there until you return it to the wallet."}
          </p>
        </div>
      </Grp>

      <Grp id="g-lightning" k="Lightning" kv={conn ? "Connected" : nwc.status === "connecting" ? "Connecting" : "Not connected"} tone={conn ? "ok" : undefined}>
        {conn ? (
          <>
            <div className="st-items">
              <div className="st-it">
                <span className="st-it-ic lit">
                  <Icon name="bolt" />
                </span>
                <div className="st-it-m">
                  <span className="st-it-t">{nwc.providerName || "Lightning wallet"}</span>
                  <span className="st-it-s">
                    {nwc.balance !== null ? `${n0(nwc.balance)} ${satUnit(nwc.balance)} · ` : ""}Nostr Wallet Connect
                  </span>
                </div>
                <div className="st-it-r">
                  <Btn kind="bare" controls="f-nwc" open={nwcOff} onClick={() => setNwcOff((o) => !o)}>
                    Disconnect
                  </Btn>
                </div>
              </div>
            </div>
            <Fold id="f-nwc" open={nwcOff}>
              <Say
                inset="r"
                acts={
                  <>
                    <Btn onClick={() => setNwcOff(false)}>Cancel</Btn>
                    <Btn
                      onClick={async () => {
                        try {
                          await nwc.disconnect();
                          nwc.reset();
                        } finally {
                          setNwcOff(false);
                        }
                      }}
                    >
                      Disconnect
                    </Btn>
                  </>
                }
              >
                <p>
                  Disconnect <b>{nwc.providerName || "this wallet"}</b>? Lightning invoices will need paying by hand until you connect it again.
                </p>
              </Say>
            </Fold>
          </>
        ) : (
          <Row wrap title="Lightning wallet" note="Connect one with Nostr Wallet Connect to pay invoices without leaving the chat.">
            <Btn kind={nwc.status === "connecting" ? undefined : "prime"} icon="bolt" busy={nwc.status === "connecting" && "Waiting for your wallet"} onClick={() => void nwc.connect()}>
              Connect wallet
            </Btn>
          </Row>
        )}
        <Row id="r-refill" title="Top up automatically" note={conn ? `When your ecash runs low, ${nwc.providerName || "your Lightning wallet"} pays an invoice for you.` : "Connect a Lightning wallet first, then it can top you up."}>
          <Sw on={conn && refill.enabled} label="Top up automatically" disabled={!conn} controls="f-refill" onChange={(v) => updateRefill({ enabled: v })} />
        </Row>
        <Fold id="f-refill" open={conn && refill.enabled}>
          <p className="st-sentence">
            When it drops below{" "}
            <SatsField label="Top up when the balance drops below, in sats" value={refill.threshold} onSave={(threshold) => updateRefill({ threshold })} />{" "}
            sats, add{" "}
            <SatsField label="Amount to add, in sats" value={refill.amount} onSave={(amount) => updateRefill({ amount })} />{" "}
            sats.
          </p>
        </Fold>
      </Grp>

      <Grp id="g-mints" k="Mints">
        {/* the share of each mint says something only when there is more than one */}
        {mints.length > 1 && (
          <div className="st-share" role="img" aria-label={mints.map((x) => `${n0(x.bal)} ${satUnit(x.bal)} at ${hostOf(x.url)}`).join(", ")}>
            {mints.map((x) => (
              <i key={x.url} style={{ flexGrow: Math.max(x.bal, tot * 0.012) }} data-on={cashu.activeMintUrl === x.url ? "" : undefined} />
            ))}
          </div>
        )}
        <div
          className="st-items"
          // with one mint there is nothing to choose: a plain row, no radio
          role={mints.length > 1 ? "radiogroup" : undefined}
          aria-label={mints.length > 1 ? "Pay from this mint" : undefined}
          onKeyDown={(e) => {
            // a radio group moves with the arrows (only the chosen mint is a tab stop)
            const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
            if (!keys.includes(e.key) || mints.length < 2) return;
            e.preventDefault();
            const i = Math.max(0, mints.findIndex((x) => x.url === cashu.activeMintUrl));
            const j = e.key === "Home" ? 0 : e.key === "End" ? mints.length - 1 : (i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1) + mints.length) % mints.length;
            cashu.setActiveMintUrlByUser(mints[j].url);
            const box = e.currentTarget;
            requestAnimationFrame(() => box.querySelectorAll<HTMLElement>('[role="radio"]')[j]?.focus());
          }}
        >
          {mints.map((x) => {
            const on = cashu.activeMintUrl === x.url;
            const last = mints.length <= 1;
            return (
              <div className="st-it noic st-mint" key={x.url}>
                {/* one mint is not a choice: a plain row, no button */}
                {last ? (
                  // (one mint holds the whole balance, which the figure above already says)
                  <div className="st-pickrow">
                    <span className="st-it-m">
                      <span className="st-it-t">{hostOf(x.url)}</span>
                    </span>
                  </div>
                ) : (
                  <button type="button" className="st-pick st-pickrow" role="radio" aria-checked={on} tabIndex={on || (!mints.some((m) => m.url === cashu.activeMintUrl) && x === mints[0]) ? 0 : -1} onClick={() => cashu.setActiveMintUrlByUser(x.url)}>
                    <span className="st-radio" aria-hidden="true" />
                    <span className="st-it-m">
                      <span className="st-it-t">{hostOf(x.url)}</span>
                      <span className="st-it-s st-mint-bal">{n0(x.bal)} {satUnit(x.bal)}</span>
                    </span>
                  </button>
                )}
                <div className="st-it-r">
                  {/* a touch screen has no tooltip: the check says its name there */}
                  {phone ? (
                    <Btn onClick={() => void clean(x.url)} disabled={cleaning === x.url}>
                      {cleaning === x.url ? "Checking" : "Check spent"}
                    </Btn>
                  ) : (
                    <Ib icon={cleaning === x.url ? "sync" : "retry"} label="Check for spent ecash" hov disabled={cleaning === x.url} onClick={() => void clean(x.url)} />
                  )}
                  {/* the last mint cannot go, so there is no bin to press */}
                  {!last && (
                    <Ib
                      icon="trash"
                      label="Remove this mint"
                      hov
                      warn
                      controls="f-rmmint"
                      open={rm === x.url}
                      onClick={() => setRm(rm === x.url ? null : x.url)}
                    />
                  )}
                  {!last && (
                    <span className="st-amt">
                      {n0(x.bal)}
                      <span className="u"> {satUnit(x.bal)}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <Fold id="f-rmmint" open={!!rmMint}>
          {rmMint && (
            <Say
              inset="r"
              acts={
                <>
                  <Btn onClick={() => setRm(null)}>Keep it</Btn>
                  {rmMint.bal > 0 && (
                    <Btn
                      icon="wallet"
                      onClick={() => {
                        ui.closeSettings();
                        ui.setSide("wallet");
                      }}
                    >
                      Send sats out
                    </Btn>
                  )}
                  <Btn kind="warn" icon="trash" onClick={() => void removeIt(rmMint.url)}>
                    {rmMint.bal > 0 ? "Remove anyway" : "Remove"}
                  </Btn>
                </>
              }
            >
              {rmMint.bal > 0 ? (
                <p>
                  Remove <b>{hostOf(rmMint.url)}</b>? It still holds <b>{n0(rmMint.bal)} {satUnit(rmMint.bal)}</b>. They stay at the mint, but this wallet stops showing them. Send them out first to keep them here.
                </p>
              ) : (
                <p>
                  Remove <b>{hostOf(rmMint.url)}</b>? It holds no sats.
                </p>
              )}
            </Say>
          )}
        </Fold>
        <div className="st-more">
          <Btn kind="bare" icon="plus" controls="f-addmint" open={adding} onClick={() => setAdding((o) => !o)}>
            Add a mint
          </Btn>
          {mints.length > 1 && <span className="st-inl">Replies are paid from the chosen mint</span>}
        </div>
        <Fold id="f-addmint" open={adding}>
          <div className="st-add">
            <input
              className="st-in mono"
              type="url"
              placeholder="https://mint.example.com"
              aria-label="Mint address"
              aria-invalid={mintErr ? true : undefined}
              enterKeyHint="done"
              autoCapitalize="off"
              spellCheck={false}
              value={mintIn}
              onChange={(e) => {
                setMintIn(e.target.value);
                setMintErr("");
              }}
              onKeyDown={(e) => e.key === "Enter" && void addMint()}
            />
            {/* one tinted action per page: Connect wallet already has it */}
            <Btn busy={addBusy && "Checking"} onClick={() => void addMint()}>
              Add mint
            </Btn>
            <p className="st-err" role="alert">
              {mintErr}
            </p>
          </div>
        </Fold>
      </Grp>
    </>
  );
}

/* A sats figure you type: a draft while you type, saved when you leave it and only above 0, so a
   field cleared to retype never leaves the top-up at "add 0 sats". */
function SatsField({ label, value, onSave }: { label: string; value: number; onSave: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="st-in st-num"
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft ?? n0(value)}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
      onBlur={() => {
        const n = Number(draft);
        if (draft !== null && n > 0) onSave(n);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
