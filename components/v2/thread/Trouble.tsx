"use client";

import React, { useState } from "react";
import { useChat } from "@/context/ChatProvider";
import type { Message } from "@/types/chat";
import { useActions } from "../useActions";
import { useMoney } from "../useMoney";
import { useUi } from "../ui";
import { Icon } from "../icons";
import { textOf } from "./content";

/* Where it stopped, what happened in plain words, and the one thing to do.
   The caret that carried the wait becomes the seam; the raw text only shows
   behind "Details". No warn colour on the words: a red retry reads as alarm. */

type Kind = "stopped" | "noanswer" | "funds" | "declined" | "unknown";

export const DECLINED = /denied due to content filtering/i;
export const isStopped = (m: Message) => m.role === "system" && /^Generation stopped/i.test(textOf(m.content).trim());

const kindOf = (raw: string): Kind => {
  const t = raw.trim();
  if (/^Generation stopped/i.test(t)) return "stopped";
  // a dropped connection reads as the SDK's refund step failing ("returned -1"): no answer came back
  if (/did not respond|timed? ?out|no response|returned -1|network error/i.test(t)) return "noanswer";
  if (DECLINED.test(t) || /content filtering/i.test(t)) return "declined";
  if (/insufficient|not enough|balance/i.test(t)) return "funds";
  return "unknown";
};

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const spell = (n: number) => WORDS[n] ?? String(n);

/** one row per kind of failure: a repeat merges, the raw line only when it adds something */
function tries(msgs: Message[]) {
  const rows: { from: number; to: number; label: string; raw: string }[] = [];
  msgs.forEach((m, i) => {
    const raw = textOf(m.content).trim();
    const k = kindOf(raw);
    const label = k === "noanswer" ? (/time/i.test(raw) ? "Timed out" : "No answer") : "Error";
    const prev = rows[rows.length - 1];
    if (prev && prev.label === label && prev.raw === raw) prev.to = i + 1;
    else rows.push({ from: i + 1, to: i + 1, label, raw });
  });
  return rows;
}
const times = (n: number) => (n === 2 ? "twice" : `${spell(n)} times`);

export default function Trouble({
  msgs,
  index,
  isLast,
  label,
  model,
}: {
  msgs: Message[];
  index: number;
  isLast: boolean;
  label: string;
  model: string;
}) {
  const { isLoading, startEditingMessage, messages } = useChat();
  const { retry } = useActions();
  const money = useMoney();
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const last = msgs[msgs.length - 1];
  const raw = textOf(last.content).trim();
  const kind = kindOf(raw);
  const canAct = isLast && !isLoading;
  const many = msgs.length > 1;

  // from the keyboard, the focus lands in the composer, not on the page body
  const tryAgain = (e: React.MouseEvent<HTMLButtonElement>) => {
    const keys = e.currentTarget.matches(":focus-visible");
    retry(index);
    if (keys) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus({ preventScroll: true }));
  };
  const switchModel = () => ui.setPicker(true);

  // stopped before any words: one quiet line and one action
  if (kind === "stopped") {
    return (
      <div className={`rd-msg rd-ai rd-sys la${isLast ? " is-last" : ""}`} role="status">
        <div className="rd-who" aria-hidden="true">
          <span className="rd-who-n">{label}</span>
        </div>
        <div className="rd-body">
          <div className="la-trouble">
            <span className="la-seam" aria-hidden="true" />
            <p className="la-quiet">
              Stopped before any words arrived.
              {canAct && (
                <button type="button" className="la-act quiet" onClick={tryAgain}>
                  Try again
                </button>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const hold = /at least (\d+)/i.exec(raw)?.[1];
  let head = "Something went wrong.";
  let sub: React.ReactNode = "The request stopped before an answer came back.";
  let prime: React.ReactNode = canAct && (
    <button type="button" className="la-act la-prime" onClick={tryAgain}>
      <Icon name="retry" />
      Try again
    </button>
  );
  let second: React.ReactNode = null;
  if (kind === "noanswer" || many) {
    head = "The provider did not answer.";
    sub = many ? `No reply after ${spell(msgs.length)} tries. Another model may answer sooner.` : "Any sats it held come back to your wallet on their own.";
    second = canAct && (
      <button type="button" className="la-act" onClick={switchModel}>
        Switch model
      </button>
    );
  } else if (kind === "funds") {
    head = "Not enough sats for this reply.";
    sub = (
      <>
        {hold && (
          <>
            {model} needs <span className="n">{Number(hold).toLocaleString("en-US")} sats</span> to start.{" "}
          </>
        )}
        Your wallet has <span className="n">{Math.floor(money.total).toLocaleString("en-US")} sats</span>.
      </>
    );
    prime = (
      <button type="button" className="la-act la-prime" onClick={() => ui.setFace("pay")}>
        <Icon name="plus" />
        Add funds
      </button>
    );
    second = (
      <button type="button" className="la-act" onClick={switchModel}>
        Switch model
      </button>
    );
  } else if (kind === "declined") {
    head = "The provider declined this request.";
    sub = "Their filter stopped it before the model answered. Rewording it, or another model, may help.";
    // the question this answered: the nearest message of yours above it
    const mine = (() => {
      for (let i = index - 1; i >= 0; i--) if (messages[i]?.role === "user") return i;
      return -1;
    })();
    prime = canAct && mine >= 0 && (
      <button type="button" className="la-act la-prime" onClick={() => startEditingMessage(mine)}>
        <Icon name="edit" />
        Edit message
      </button>
    );
    second = canAct && (
      <button type="button" className="la-act" onClick={switchModel}>
        Switch model
      </button>
    );
  }
  const rows = many ? tries(msgs) : [];
  const moreLabel = many ? `${open ? "Hide" : "Show"} the ${spell(msgs.length)} tries` : "Details";
  const showMore = many || kind === "unknown";

  return (
    <div className={`rd-msg rd-ai rd-sys la${isLast ? " is-last" : ""}`} role="alert">
      <div className="rd-who" aria-hidden="true">
        <span className="rd-who-n">{label}</span>
      </div>
      <div className="rd-body">
        <div className="la-trouble" data-enter="">
          <div className="la-t-msg">
            <span className="la-seam" aria-hidden="true" />
            <p className="la-t-head">{head}</p>
          </div>
          <p className="la-t-sub">{sub}</p>
          {(prime || second || showMore) && (
            <div className="la-acts">
              {prime}
              {second}
              {showMore && (
                <button type="button" className="la-act quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                  <Icon name="right" />
                  {moreLabel}
                </button>
              )}
            </div>
          )}
          {showMore && (
            <div className="la-more" data-open={open ? "" : undefined}>
              <div>
                <div className="la-more-in" inert={!open}>
                  {many ? (
                    <ol className="la-tries">
                      {rows.map((r) => (
                        <li className="la-try" key={`${r.from}-${r.label}`}>
                          <span className="i">{r.from === r.to ? r.from : r.to - r.from > 1 ? `${r.from} to ${r.to}` : `${r.from}, ${r.to}`}</span>
                          <span className="l">
                            {r.label}
                            {r.to > r.from && <span className="x">, {times(r.to - r.from + 1)}</span>}
                          </span>
                          {r.label !== "No answer" && <span className="r">{r.raw}</span>}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="la-raw">
                      {raw}
                      <button
                        type="button"
                        className="rd-code-btn code-copy"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(raw);
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1400);
                          } catch {
                            // refused: nothing to confirm
                          }
                        }}
                      >
                        <span className="rd-swap" data-on={copied ? "" : undefined}>
                          <Icon name="copy" size={14} />
                          <Icon name="check" size={14} />
                        </span>
                        <span className="rd-swapw" data-on={copied ? "" : undefined}>
                          <span>Copy</span>
                          <span>Done</span>
                        </span>
                      </button>
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
}
