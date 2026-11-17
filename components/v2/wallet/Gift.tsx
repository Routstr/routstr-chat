"use client";

import React, { useEffect, useRef, useState } from "react";
import { giftSeed, usePurse } from "@/features/wallet/view";
import { useUnclaimedTokensStore } from "@/features/wallet/state/unclaimedTokensStore";
import { giftId, giftLink } from "../address";
import { rememberMade } from "../gift/records";
import { Icon } from "../icons";
import { satsOf, useActiveMint } from "./Wallet";
import {
  Amount,
  CopyLine,
  Note,
  NumT,
  Pane,
  Picks,
  Share,
  Spin,
  Two,
  fmt,
  useCopy,
} from "./bits";

/* A gift: sats as a link a friend opens to chat right away, no sign-up and no card. It is a
   token like any other (made by the purse, written to the wallet book the moment it exists,
   listed under Your tokens until it is opened or taken back); it only carries a message and
   who it is from ("… — Name", the way the gift reads it). */

const FROM = "routstr.gift.from";
const remembered = () => {
  try {
    return localStorage.getItem(FROM) ?? "";
  } catch {
    return "";
  }
};
const remember = (name: string) => {
  try {
    localStorage.setItem(FROM, name);
  } catch {
    // not remembered; typed again next time
  }
};

export default function Gift({
  say,
  toTokens,
}: {
  say: (t: string) => void;
  toTokens: () => void;
}) {
  const purse = usePurse();
  const tokens = useUnclaimedTokensStore((x) => x.unclaimedTokens);
  const mint = useActiveMint();
  const { copied, copy } = useCopy(say);
  const [amount, setAmount] = useState("500");
  const [bump, setBump] = useState(0);
  const [made, setMade] = useState<{
    id: string;
    from: string;
    message: string;
    link: string;
  } | null>(null);
  const [making, setMaking] = useState(false);
  const [failed, setFailed] = useState(false);
  const fromEl = useRef<HTMLInputElement>(null);
  const messageEl = useRef<HTMLTextAreaElement>(null);
  const field = useRef<HTMLLabelElement>(null);

  // who it is from, as last time
  useEffect(() => {
    if (fromEl.current && !fromEl.current.value)
      fromEl.current.value = remembered();
  }, []);

  const have = mint.bal;
  const n = +amount || 0;
  // as a token: the mint may keep a fee for making it and for claiming it (the gift carries that one)
  const [fees, setFees] = useState<{
    at: string;
    fee: number | null;
    most: number;
  } | null>(null);
  const feesAt = `${mint.active?.url} ${have} ${n}`;
  useEffect(() => {
    const from = purse();
    const url = mint.active?.url;
    if (!from || !url || !have) return;
    let live = true;
    from.tokenFees(url, n).then(
      (f) => live && setFees({ at: feesAt, ...f }),
      (e) => console.warn("Could not work out the mint's fee for a gift", e)
    );
    return () => {
      live = false;
    };
  }, [feesAt]);
  const known = fees?.at === feesAt ? fees : null;
  const most = known?.most ?? have;
  const fee = known?.fee ?? 0;

  const make = async () => {
    const from = purse();
    if (!from || !mint.active || !(n > 0 && n <= most) || making) return;
    const name = (fromEl.current?.value ?? "").trim().slice(0, 40);
    const message = (messageEl.current?.value ?? "").trim();
    remember(name);
    const url = mint.active.url;
    // its coins are made from a seed of its own, so its link need hold only that (and its message)
    const seed = giftSeed();
    const memo = name ? `${message} — ${name}` : message || undefined;
    setMaking(true);
    setFailed(false);
    let token: string;
    try {
      // a token like any other: listed until it is opened or taken back
      token = await from.send(url, n, undefined, undefined, seed);
    } catch (e) {
      console.error("Could not make the gift:", e);
      setFailed(true);
      return;
    } finally {
      setMaking(false);
    }
    // its own listing, found by the token itself (another tab may make one at the same moment)
    const fresh = useUnclaimedTokensStore
      .getState()
      .unclaimedTokens.find((t) => t.token === token);
    if (!fresh) return;
    const link = giftLink({ seed, mint: url, memo });
    // so Your tokens can say it is a gift, and copy its link again
    rememberMade({ id: giftId(seed), token: fresh.token, link, memo, at: Date.now() });
    setMade({ id: fresh.id, from: name, message, link });
    say(`Gift of ${fmt(satsOf(fresh.amount, fresh.unit))} sats ready`);
  };

  const t = made ? tokens.find((x) => x.id === made.id) : null;
  if (made && t) {
    const sats = satsOf(t.amount, t.unit);
    const link = made.link;
    const line = `${made.from ? `${made.from} sent you` : "Here are"} ${fmt(sats)} sats to chat with AI. No sign-up, just open the link.`;
    return (
      <Pane
        cls="is-inv"
        dir="u"
        fill={
          <div className="wl-inv wl-gift-made">
            <NumT n={sats} />
            {(made.message || made.from) && (
              <p className="wl-gift-card">
                {made.message && <span>“{made.message}”</span>}
                {made.from && <span className="by">from {made.from}</span>}
              </p>
            )}
            <CopyLine
              value={link}
              copied={copied === t.id}
              label="Copy gift link"
              onCopy={() => void copy(link, t.id)}
            />
            <div className="wl-inv-slot">
              <p className="wl-status" role="status">
                Whoever opens it first gets the sats. Until then you can take it
                back from Your tokens.
              </p>
            </div>
          </div>
        }
        main={
          <div className="wl-two">
            <button
              type="button"
              className="wl-go"
              onClick={() => void copy(link, t.id)}
            >
              <Icon name={copied === t.id ? "check" : "link"} size={16} />
              {copied === t.id ? "Link copied" : "Copy link"}
            </button>
            {typeof navigator !== "undefined" &&
            typeof navigator.share === "function" ? (
              <button
                type="button"
                className="wl-soft"
                onClick={() =>
                  void navigator
                    .share({ text: line, url: link })
                    .catch(() => {})
                }
              >
                <Share />
                Share
              </button>
            ) : (
              <button
                type="button"
                className="wl-soft"
                onClick={() => setMade(null)}
              >
                Done
              </button>
            )}
          </div>
        }
        after={
          <button type="button" className="wl-link" onClick={toTokens}>
            Your tokens
          </button>
        }
      />
    );
  }

  const over = n > most;
  const mn = mint.active?.name ?? "this mint";
  const kept = fee > 0 ? `The mint keeps ${fmt(fee)} as its fee` : undefined;
  return (
    <Pane
      cls="is-top"
      fill={
        <div className="wl-gift">
          <p className="wl-gift-lead">
            Give a friend AI chats. No sign-up, no card: they open the link and
            start.
          </p>
          <div className="wl-amtset">
            <Amount
              value={amount}
              onChange={setAmount}
              onEnter={() => void make()}
              bump={bump}
              fieldRef={field}
              warn={over}
              buys={
                n > have ? (
                  <Two a={`Only ${fmt(have)} sats on ${mn}`} />
                ) : over ? (
                  <Two
                    a={`At most ${fmt(most)} sats on ${mn}`}
                    b={`The mint keeps ${fmt(have - most)} as its fee`}
                  />
                ) : n <= 0 ? (
                  <Two a={`You have ${fmt(have)} sats on ${mn}`} />
                ) : (
                  <Two
                    a={`${fmt(have - n - fee)} sats stay with you`}
                    b={kept}
                  />
                )
              }
            />
            <Picks
              list={[
                [100, "100"],
                [500, "500"],
                [1000, "1,000"],
              ]}
              value={n}
              onPick={(p) => {
                setAmount(String(p));
                setBump((b) => b + 1);
              }}
            />
          </div>
          <label className="wl-gift-f">
            <span>From</span>
            <input
              ref={fromEl}
              type="text"
              maxLength={40}
              autoComplete="nickname"
              placeholder="Your name"
            />
          </label>
          <label className="wl-gift-f">
            <span>Message</span>
            <textarea
              ref={messageEl}
              rows={2}
              maxLength={140}
              placeholder="For your exam week. Ask it anything."
            />
          </label>
        </div>
      }
      main={
        <button
          type="button"
          className="wl-go"
          data-busy={making ? "" : undefined}
          disabled={making || !(n > 0 && n <= most)}
          onClick={() => void make()}
        >
          {making ? (
            <>
              <Spin />
              Making the gift
            </>
          ) : (
            <>
              <Icon name="gift" size={16} />
              Make gift link
            </>
          )}
        </button>
      }
      after={
        failed ? (
          <Note
            kind="warn"
            text="The gift could not be made. Nothing left your wallet."
            center
          />
        ) : (
          <p className="wl-hint">
            A link that opens once. You can take it back until it is opened.
          </p>
        )
      }
    />
  );
}
