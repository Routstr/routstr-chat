"use client";

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@/context/ChatProvider";
import type { Message, MessageContent } from "@/types/chat";
import { getTextFromContent } from "@/utils/messageUtils";
import { useActions } from "../useActions";
import { toMs } from "../format";
import { Icon } from "../icons";
import Prose from "./Prose";
import StoredImage from "./StoredImage";
import { parseContent, thinkingTopic } from "./content";
import { recallThinking, takeOpen } from "./smooth";
import { hostOf } from "./links";

/* Finished turns as a book spread: who spoke hangs in the left margin, where
   it came from hangs in the right, and the words keep one measure. Messages
   are memoised on their own props, so a streaming answer re-renders only
   itself. */

export type Go = (depth: number, d: -1 | 1) => void;

export const costLabel = (s?: number) => {
  if (!s || s <= 0) return "";
  return `${s < 1 ? s.toFixed(3) : s < 10 ? s.toFixed(1) : Math.round(s).toLocaleString()} sats`;
};

/** 10:31 today, "Mon 10:31" this week, "3 Sep" before that */
export const stamp = (t?: number) => {
  const ms = toMs(t);
  if (!ms) return "";
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const age = Date.now() - ms;
  if (new Date().toDateString() === d.toDateString()) return time;
  if (age < 6 * 86_400_000) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A just-finished reply's cost counts up once, instead of appearing. */
function RollingCost({ value }: { value: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduced()) return setV(value);
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 520);
      setV(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{costLabel(Math.max(v, 0.001))}</>;
}

/** A digit that rolls to its new value: up when it grows, down when it shrinks. */
function Roll({ value }: { value: number }) {
  const [shown, setShown] = useState({ now: value, was: null as number | null, up: true });
  useEffect(() => {
    if (value === shown.now) return;
    if (reduced()) return setShown({ now: value, was: null, up: true });
    setShown((s) => ({ now: value, was: s.now, up: value > s.now }));
    const t = window.setTimeout(() => setShown((s) => ({ ...s, was: null })), 220);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const dir = shown.up ? "up" : "down";
  return (
    <span className="rd-roll">
      {shown.was !== null && (
        <span key={`o${shown.was}`} className={`rd-roll-out-${dir}`}>
          {shown.was}
        </span>
      )}
      <span key={`n${shown.now}`} className={shown.was !== null ? `rd-roll-in-${dir}` : undefined}>
        {shown.now}
      </span>
    </span>
  );
}

function Vers({ at, of, go }: { at: number; of: number; go: (d: -1 | 1) => void }) {
  return (
    <div className="rd-vers" role="group" aria-label={`Version ${at} of ${of}`}>
      <button type="button" className="rd-tool" onClick={() => !(at <= 1) && go(-1)} aria-disabled={at <= 1} aria-label="Previous version" data-tip="Previous version">
        <Icon name="left" />
      </button>
      <span className="rd-vers-n" aria-hidden="true">
        <Roll value={at} />
        <span className="rd-of">
          / <Roll value={of} />
        </span>
      </span>
      <button type="button" className="rd-tool" onClick={() => !(at >= of) && go(1)} aria-disabled={at >= of} aria-label="Next version" data-tip="Next version">
        <Icon name="right" />
      </button>
    </div>
  );
}

/** Copy with a check that answers in place; the live region says it once. */
function useCopied() {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      clearTimeout(t.current);
      t.current = setTimeout(() => setDone(false), 1400);
    } catch {
      // clipboard refused: nothing to confirm
    }
  }, []);
  return { done, copy };
}

function CopyTool({ text, side }: { text: string; side?: "right" }) {
  const { done, copy } = useCopied();
  return (
    <>
      <button type="button" className="rd-tool" onClick={() => void copy(text)} aria-label="Copy" data-tip={done ? "Copied" : "Copy"} data-tip-side={side}>
        <span className="rd-swap" data-on={done ? "" : undefined}>
          <Icon name="copy" />
          <Icon name="check" />
        </span>
      </button>
      <span className="sr" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </>
  );
}

/* ══ reasoning: one quiet line, a well when you open it ════════════════════ */
function Transcript({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return <span key={i} className="rd-tgap" />;
        const head = /^(\*\*[^*]+\*\*|#{1,4}\s.+)$/.test(t);
        const clean = t.replace(/^#{1,4}\s/, "").replace(/\*\*/g, "");
        return (
          <span key={i} className={head ? "rd-th" : "rd-tl"}>
            {clean}
          </span>
        );
      })}
    </>
  );
}

export function Thought({ text, answer }: { text: string; answer: string }) {
  const [was] = useState(() => takeOpen(answer));
  const [open, setOpen] = useState(!!was);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (was?.focus) btn.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const topic = thinkingTopic(text);
  const well = useRef<HTMLDivElement>(null);
  // the well says which way there is more to read
  const fades = () => {
    const el = well.current;
    if (!el) return;
    const over = el.scrollHeight - el.clientHeight > 1;
    el.toggleAttribute("data-more-b", over && el.scrollTop < el.scrollHeight - el.clientHeight - 2);
    el.toggleAttribute("data-more-t", over && el.scrollTop > 2);
  };
  useLayoutEffect(fades, [open, text]);
  return (
    <>
      <button type="button" className="rd-thought" ref={btn} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="right" size={14} className="rd-chev" />
        <span className="rd-thought-l">Thought it through</span>
        {topic && <span className="rd-thought-t">{topic}</span>}
      </button>
      <div className="rd-think" data-open={open ? "" : undefined}>
        <div className="rd-think-clip">
          <div className="rd-think-in scroll" ref={well} inert={!open} onScroll={fades}>
            <Transcript text={text} />
          </div>
        </div>
      </div>
    </>
  );
}

/* ══ an answer ═════════════════════════════════════════════════════════════ */
type Source = { url: string; title: string };

/** The line a citation sits on: the character before it, not the raised numeral. */
function lineOf(cite: HTMLElement) {
  const prev = cite.previousSibling;
  if (prev && prev.nodeType === 3 && (prev as Text).length) {
    const r = document.createRange();
    r.setStart(prev, (prev as Text).length - 1);
    r.setEnd(prev, (prev as Text).length);
    const rs = r.getClientRects();
    if (rs.length) return rs[rs.length - 1];
  }
  return cite.getBoundingClientRect();
}

const wide = (answer: HTMLElement | null) => {
  const probe = answer?.querySelector(".rd-notes");
  return !!probe && getComputedStyle(probe).display !== "none";
};

/* Where there is no margin (a narrow panel, a phone), a citation opens a small
   card under its line. Hover or focus shows it; a click, tap or Enter pins it
   and moves focus to "Open source". */
function CiteCard({
  cite,
  source,
  n,
  pinned,
  onEnter,
  onLeave,
  onClose,
}: {
  cite: HTMLElement;
  source: Source;
  n: string;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: (back?: boolean) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLAnchorElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ox: number; up: boolean; width?: number } | null>(null);
  useLayoutEffect(() => {
    const card = el.current;
    const box = card?.parentElement;
    const thread = cite.closest(".thread");
    if (!card || !box || !thread) return;
    const place = () => {
      const b = box.getBoundingClientRect();
      const r = cite.getBoundingClientRect();
      const line = lineOf(cite);
      const phone = window.innerWidth <= 760;
      const width = phone ? Math.round(b.width) : undefined;
      if (width) card.style.width = `${width}px`;
      const x = phone ? 0 : Math.min(b.width - card.offsetWidth, Math.max(0, r.left - b.left - 18));
      const h = card.offsetHeight;
      const view = thread.getBoundingClientRect();
      const below = line.bottom + 8;
      const up = below + h > view.bottom - 8 && line.top - 8 - h > view.top;
      setPos({ left: Math.round(x), top: Math.round((up ? line.top - 8 - h : below) - b.top), ox: Math.round(r.left - b.left - x + r.width / 2), up, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [cite]);
  useEffect(() => {
    if (pinned) go.current?.focus({ preventScroll: true });
  }, [pinned]);
  const host = source.url ? hostOf(source.url) : "";
  return (
    <div
      ref={el}
      className="rd-card"
      role="dialog"
      aria-label={`Source ${n}`}
      data-pinned={pinned ? "1" : undefined}
      data-up={pos?.up ? "" : undefined}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, width: pos?.width, visibility: pos ? undefined : "hidden", "--ox": `${pos?.ox ?? 20}px` } as React.CSSProperties}
      onPointerEnter={onEnter}
      onPointerLeave={(e) => {
        if (!pinned && !cite.contains(e.relatedTarget as Node)) onLeave();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
        if (e.key === "Tab") {
          e.preventDefault();
          onClose(e.shiftKey);
          if (!e.shiftKey) {
            // carry on from the citation
            const all = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])')).filter(
              (x) => !x.closest(".rd-card, [inert], [hidden]") && x.getClientRects().length
            );
            all[all.indexOf(cite) + 1]?.focus();
          }
        }
      }}
    >
      <span className="rd-card-n">{n}</span>
      <span className="rd-card-h">{host}</span>
      {source.title && source.title !== host && <span className="rd-card-t">{source.title}</span>}
      <a className="rd-card-go" ref={go} href={source.url} target="_blank" rel="noopener noreferrer">
        <Icon name="link" size={14} />
        <span>Open source</span>
      </a>
    </div>
  );
}

function Strip({
  text,
  versions,
  cost,
  roll,
  model,
  canRetry,
  onRetry,
  stopped,
}: {
  text: string;
  versions?: { at: number; of: number; go: (d: -1 | 1) => void };
  cost?: string;
  roll?: number;
  model: string;
  canRetry: boolean;
  onRetry: () => void;
  stopped?: boolean;
}) {
  const [turning, setTurning] = useState(false);
  return (
    <div className="rd-strip">
      {versions && versions.of > 1 && <Vers {...versions} />}
      <div className="rd-tools">
        <CopyTool text={text} />
        <button
          type="button"
          className={`rd-tool${turning ? " is-turning" : ""}`}
          onClick={(e) => {
            const keys = e.currentTarget.matches(":focus-visible");
            setTurning(true);
            window.setTimeout(() => setTurning(false), 440);
            onRetry();
            if (keys) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus({ preventScroll: true }));
          }}
          disabled={!canRetry}
          aria-label="Try again"
          data-tip="Try again"
        >
          <Icon name="retry" />
        </button>
      </div>
      <p className="rd-sum">
        <span className="rd-model">{model}</span>
        <span className="rd-cost">
          {stopped && (
            <>
              stopped
              {(roll || cost) && <span className="stop-dot"> · </span>}
            </>
          )}
          {roll ? <RollingCost value={roll} /> : cost}
        </span>
      </p>
    </div>
  );
}

export const Answer = memo(function Answer({
  msg,
  index,
  depth,
  vAt,
  vOf,
  isLast,
  label,
  full,
  busy,
  stopped,
  onVersion,
  onRetry,
}: {
  msg: Message;
  index: number;
  depth: number;
  vAt: number;
  vOf: number;
  isLast: boolean;
  label: string;
  full: string;
  busy: boolean;
  stopped?: boolean;
  onVersion: Go;
  onRetry: (index: number) => void;
}) {
  const parsed = useMemo(() => parseContent(msg.content), [msg.content]);
  const remembered = parsed.thinking || recallThinking(parsed.text);
  // the cost settles after the words land: if it arrives while you watch, it counts up
  const costAtMount = useRef(msg.satsSpent);
  const roll = !costAtMount.current && msg.satsSpent ? msg.satsSpent : undefined;
  const sources = parsed.sources;
  const root = useRef<HTMLElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  const who = useRef<HTMLSpanElement>(null);
  const [named, setNamed] = useState(false);

  // the margin names the model; the strip adds the full name only when the
  // margin label is cut or says less than the real name
  useLayoutEffect(() => {
    const n = who.current;
    if (!n) return;
    const cut = n.scrollHeight > n.clientHeight + 1;
    setNamed(cut || full.toLowerCase() !== label.toLowerCase());
  }, [label, full]);

  // each source hangs beside the line that first cites it; notes never overlap
  const layoutNotes = useCallback(() => {
    const box = answer.current;
    if (!box || !wide(box)) return;
    const top0 = box.getBoundingClientRect().top;
    let floor = -Infinity;
    box.querySelectorAll<HTMLElement>(".rd-note").forEach((note) => {
      const cite = box.querySelector<HTMLElement>(`.rd-cite[data-n="${note.dataset.n}"]`);
      let y: number;
      if (cite) {
        const line = lineOf(cite);
        const nh = parseFloat(getComputedStyle(note).lineHeight) || 15;
        y = line.top - top0 + (line.height - nh) / 2 + 1;
      } else {
        // a source nobody cites hangs by the answer's last lines
        y = (box.querySelector(".rd-ans-in")?.getBoundingClientRect().bottom ?? top0) - top0 - note.offsetHeight;
      }
      y = Math.max(y, floor);
      note.style.transform = `translateY(${Math.round(y)}px)`;
      floor = y + note.offsetHeight + 12;
    });
  }, []);
  useLayoutEffect(() => {
    if (!sources.length) return;
    layoutNotes();
    const box = answer.current;
    if (!box) return;
    let w = box.clientWidth;
    const ro = new ResizeObserver(() => {
      // only a change of width moves lines; heights change while things open
      if (box.clientWidth === w) return;
      w = box.clientWidth;
      layoutNotes();
    });
    ro.observe(box);
    document.fonts?.ready.then(layoutNotes);
    return () => ro.disconnect();
  }, [sources.length, parsed.text, layoutNotes]);

  // cite and note light up together
  const lite = (n: string | undefined, on: boolean) => {
    if (!n) return;
    root.current?.querySelectorAll(`.rd-cite[data-n="${n}"], .rd-note[data-n="${n}"], .rd-src[data-n="${n}"]`).forEach((el) => el.toggleAttribute("data-lit", on));
  };
  const [card, setCard] = useState<{ cite: HTMLElement; n: string; pinned: boolean } | null>(null);
  const closeT = useRef(0);
  // focus handed back from a closed card must not open it again
  const returning = useRef(false);
  const closeCard = useCallback((back?: boolean) => {
    window.clearTimeout(closeT.current);
    setCard((c) => {
      if (c) {
        if (!c.cite.matches(":hover")) c.cite.removeAttribute("data-lit");
        if (back && document.activeElement !== c.cite) {
          returning.current = true;
          c.cite.focus({ preventScroll: true });
          requestAnimationFrame(() => (returning.current = false));
        }
      }
      return null;
    });
  }, []);
  const soonClose = () => {
    window.clearTimeout(closeT.current);
    closeT.current = window.setTimeout(() => setCard((c) => (c && !c.pinned ? (c.cite.removeAttribute("data-lit"), null) : c)), 150);
  };
  const openCard = (cite: HTMLElement, pinned: boolean) => {
    window.clearTimeout(closeT.current);
    const n = cite.dataset.n;
    if (!n || !sources[Number(n) - 1]) return;
    setCard((c) => (c && c.cite === cite ? { ...c, pinned: c.pinned || pinned } : { cite, n, pinned }));
    lite(n, true);
  };
  // a press outside a pinned card closes it
  useEffect(() => {
    if (!card?.pinned) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".rd-card") || t === card.cite) return;
      closeCard();
    };
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [card, closeCard]);

  const onOver = (e: React.PointerEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite, .rd-note, .rd-src");
    if (!c) return;
    lite(c.dataset.n, true);
    if (c.matches(".rd-cite") && !wide(answer.current) && e.pointerType !== "touch") openCard(c, false);
  };
  const onOut = (e: React.PointerEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite, .rd-note, .rd-src");
    if (!c || c.contains(e.relatedTarget as Node)) return;
    const mine = card?.cite === c;
    if (!mine) lite(c.dataset.n, false);
    if (mine && !card?.pinned && !(e.relatedTarget as HTMLElement | null)?.closest?.(".rd-card")) soonClose();
  };
  const onFocusIn = (e: React.FocusEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite, .rd-note");
    if (!c) return;
    lite(c.dataset.n, true);
    if (c.matches(".rd-cite") && !wide(answer.current) && !returning.current) openCard(c, false);
  };
  const onFocusOut = (e: React.FocusEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite, .rd-note");
    if (!c) return;
    if ((e.relatedTarget as HTMLElement | null)?.closest?.(".rd-card")) return;
    lite(c.dataset.n, false);
    if (card?.cite === c && !card.pinned) closeCard();
  };
  const onClick = (e: React.MouseEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".rd-cite");
    if (!c || wide(answer.current)) return;
    // no margin: a citation opens its card instead of leaving the page
    e.preventDefault();
    if (card?.cite === c && card.pinned) return closeCard();
    openCard(c, true);
  };

  return (
    <article
      ref={root}
      className={`rd-msg rd-ai${isLast ? " is-last" : ""}`}
      aria-label={full}
      data-index={index}
      data-name={named ? "" : undefined}
      onPointerOver={onOver}
      onPointerOut={onOut}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
      onClick={onClick}
    >
      <div className="rd-who" aria-hidden="true">
        <span className="rd-who-n" ref={who} title={full}>
          {label}
        </span>
        <span className="rd-when">{stamp(msg._createdAt)}</span>
      </div>
      <div className="rd-body">
        {remembered && <Thought text={remembered} answer={parsed.text} />}
        <div className="rd-answer" ref={answer}>
          <div className="rd-ans-in">
            {parsed.text && <Prose content={parsed.text} />}
            {parsed.images.map((im, i) => (
              <StoredImage key={i} item={im} />
            ))}
          </div>
          {sources.length > 0 && (
            <>
              <section className="rd-sources" aria-label="Sources">
                <h4 className="rd-sources-t">Sources</h4>
                <ol>
                  {sources.map((s, i) => (
                    <li className="rd-src" data-n={i + 1} key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        <span className="n">{i + 1}</span>
                        <span className="t">{s.title || hostOf(s.url)}</span>
                        {s.title && s.title !== hostOf(s.url) && <span className="h">{hostOf(s.url)}</span>}
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
              <div className="rd-notes">
                {sources.map((s, i) => {
                  const host = hostOf(s.url);
                  const title = s.title && s.title !== host ? s.title : "";
                  return (
                    <a
                      key={s.url}
                      className="rd-note"
                      data-n={i + 1}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Source ${i + 1}: ${title || host}, ${host}`}
                    >
                      <span className="rd-note-n">{i + 1}</span>
                      <span className="rd-note-h">{host}</span>
                      <span className="rd-note-t">{title}</span>
                    </a>
                  );
                })}
              </div>
            </>
          )}
          {card && (
            <CiteCard
              cite={card.cite}
              n={card.n}
              source={sources[Number(card.n) - 1]}
              pinned={card.pinned}
              onEnter={() => window.clearTimeout(closeT.current)}
              onLeave={soonClose}
              onClose={closeCard}
            />
          )}
        </div>
        <Strip
          text={parsed.text}
          versions={vOf > 1 ? { at: vAt, of: vOf, go: (d) => onVersion(depth, d) } : undefined}
          cost={roll ? undefined : costLabel(msg.satsSpent)}
          roll={roll}
          model={full.toLowerCase()}
          canRetry={!busy}
          onRetry={() => onRetry(index)}
          stopped={stopped}
        />
      </div>
    </article>
  );
});

/* ══ your message ══════════════════════════════════════════════════════════ */

/* Pasted code and logs keep their columns: fences first, then paragraphs whose
   lines mostly look like code (indent, compiler arrows and gutters, lines
   ending in { or ;, error: / note: heads). */
const CODEISH = /^(\s{2,}\S|\s*(-->|\||\d+\s*\|)|\s*[}\])][;,)]*\s*$|.*[{;]\s*$|(error|warning|note|help)(\[\w+\])?:)/;
type QBlock = { kind: "code" | "prose"; lines: string[]; fenced: boolean };
export function qBlocks(text: string): QBlock[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: QBlock[] = [];
  let para: string[] = [];
  const push = (kind: QBlock["kind"], ls: string[], fenced = false) => {
    const last = blocks[blocks.length - 1];
    if (kind === "code" && !fenced && last?.kind === "code" && !last.fenced) last.lines.push("", ...ls);
    else blocks.push({ kind, lines: ls, fenced });
  };
  const flush = () => {
    if (!para.length) return;
    const code = para.filter((l) => CODEISH.test(l)).length / para.length >= 0.6;
    push(code ? "code" : "prose", para);
    para = [];
  };
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (/^\s*```/.test(l)) {
      flush();
      const body: string[] = [];
      k++;
      while (k < lines.length && !/^\s*```/.test(lines[k])) body.push(lines[k++]);
      push("code", body, true);
      continue;
    }
    if (!l.trim()) {
      flush();
      continue;
    }
    para.push(l);
  }
  flush();
  return blocks;
}

/** A long file name is cut in the middle: its end (year, .pdf) tells files apart. */
function DocName({ name }: { name: string }) {
  if (name.length <= 14)
    return (
      <span className="rd-doc-n" title={name}>
        {name}
      </span>
    );
  return (
    <span className="rd-doc-n" title={name}>
      <span className="rd-doc-h">{name.slice(0, -8)}</span>
      <span className="rd-doc-e">{name.slice(-8)}</span>
    </span>
  );
}
const sizeOf = (b?: number) => (!b ? "" : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Edit() {
  const { editingContent, setEditingContent, cancelEditing, isLoading } = useChat();
  const { saveEdit } = useActions();
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const a = area.current;
    if (!a) return;
    a.focus();
    a.setSelectionRange(a.value.length, a.value.length);
  }, []);
  useLayoutEffect(() => {
    const a = area.current;
    if (!a) return;
    a.style.height = "auto";
    a.style.height = `${Math.min(a.scrollHeight, 360)}px`;
  }, [editingContent]);
  // cancelled, the focus goes back to the Edit button this box replaced
  const cancel = () => {
    const art = area.current?.closest("article");
    cancelEditing();
    requestAnimationFrame(() => art?.querySelector<HTMLElement>('.rd-tool[aria-label="Edit"]')?.focus());
  };
  const send = () => {
    if (!editingContent.trim() || isLoading) return;
    void saveEdit();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus());
  };
  return (
    <div className="rd-edit">
      <textarea
        ref={area}
        className="rd-edit-f"
        rows={1}
        value={editingContent}
        spellCheck
        aria-label="Edit your message"
        onChange={(e) => setEditingContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      />
      <div className="rd-edit-rowwrap">
        <div className="rd-edit-row">
          <span className="rd-edit-hint">
            <kbd>Enter</kbd> sends a new version · <kbd>Esc</kbd> cancels
          </span>
          <span className="rd-edit-acts">
            <button type="button" className="rd-btn" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="rd-btn rd-btn-prime" onClick={send} disabled={!editingContent.trim() || isLoading}>
              Send
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

export const Mine = memo(function Mine({
  msg,
  index,
  depth,
  vAt,
  vOf,
  isLast,
  busy,
  editing,
  fresh,
  onVersion,
  onEdit,
}: {
  msg: Message;
  index: number;
  depth: number;
  vAt: number;
  vOf: number;
  isLast: boolean;
  busy: boolean;
  editing: boolean;
  fresh: boolean;
  onVersion: Go;
  onEdit: (index: number) => void;
}) {
  const parsed = useMemo(() => parseContent(msg.content), [msg.content]);
  const text = getTextFromContent(msg.content);
  const blocks = useMemo(() => qBlocks(text), [text]);
  const lines = text.split("\n").length;
  const long = text.length > 900 || lines > 12;
  const plain = text.length > 280 || lines > 4;
  const [openAll, setOpenAll] = useState(false);
  const [more, setMore] = useState(0);
  const [tapped, setTapped] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);

  // the clamp ends on the last whole line of text inside seven (six on a
  // phone), never on a blank one, so the fade always lies over words
  useLayoutEffect(() => {
    const w = wrap.current;
    if (!long || !w) return;
    const measure = () => {
      const q = w.querySelector<HTMLElement>(".rd-q");
      if (!q) return;
      const top = q.getBoundingClientRect().top;
      const lh = parseFloat(getComputedStyle(q).lineHeight) || 28;
      const limit = lh * (window.innerWidth <= 760 ? 6 : 7) + 1;
      const ls = Array.from(q.querySelectorAll<HTMLElement>(".rd-ql"));
      const r = document.createRange();
      let at = 0;
      let lastK = -1;
      ls.forEach((l, k) => {
        if (!l.textContent?.trim()) return;
        r.selectNodeContents(l);
        for (const b of Array.from(r.getClientRects())) {
          const y = b.bottom - top;
          if (y <= limit && y > at) {
            at = y;
            lastK = k;
          }
        }
      });
      w.style.setProperty("--rd-clamp", `${Math.round(at + 4)}px`);
      setMore(ls.slice(lastK + 1).filter((l) => l.textContent?.trim()).length);
    };
    measure();
    let wd = w.clientWidth;
    const ro = new ResizeObserver(() => {
      if (w.clientWidth === wd) return;
      wd = w.clientWidth;
      measure();
    });
    ro.observe(w);
    return () => ro.disconnect();
  }, [long, text]);

  // a phone bubble hugs its widest line: wrapped text leaves the box at the
  // width it had before wrapping, which strands an empty band on the right
  useLayoutEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const hug = () => {
      w.style.width = "";
      if (!window.matchMedia("(max-width: 760px)").matches || w.querySelector(".rd-qc")) return;
      const r = document.createRange();
      const lines = () => {
        let right = 0;
        let left = Infinity;
        let n = 0;
        w.querySelectorAll(".rd-ql").forEach((l) => {
          r.selectNodeContents(l);
          for (const b of Array.from(r.getClientRects())) {
            right = Math.max(right, b.right);
            left = Math.min(left, b.left);
            n++;
          }
        });
        return { span: right - left, n };
      };
      const was = lines();
      if (!was.n) return;
      const cs = getComputedStyle(w);
      const need = Math.ceil(was.span + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 1);
      if (need >= w.offsetWidth - 1) return;
      w.style.width = `${need}px`;
      // the narrower box must not wrap into more lines
      if (lines().n > was.n) w.style.width = "";
    };
    hug();
    let vw = window.innerWidth;
    const on = () => {
      if (window.innerWidth === vw) return;
      vw = window.innerWidth;
      hug();
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [text]);

  // a phone: a tap on the bubble opens its row (time, copy, edit)
  useEffect(() => {
    if (!tapped) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setTapped(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [tapped]);

  const atts = parsed.images.length > 0 || parsed.files.length > 0;
  return (
    <article
      ref={root}
      className={`rd-msg rd-me${isLast ? " is-last" : ""}${editing ? " is-editing" : ""}${tapped ? " is-open" : ""}${fresh ? " msg-enter" : ""}`}
      aria-label="You"
      data-index={index}
    >
      <div className="rd-who" aria-hidden="true">
        <span className="rd-who-n">you</span>
        <span className="rd-when">{editing ? <span className="rd-editing">editing</span> : stamp(msg._createdAt)}</span>
        {vOf > 1 && !editing && (
          <span className="rd-who-v">
            version <Roll value={vAt} /> of <Roll value={vOf} />
          </span>
        )}
      </div>
      {editing ? (
        <Edit />
      ) : (
        <>
          <div
            className="rd-q-wrap"
            ref={wrap}
            data-long={long ? "" : undefined}
            data-plain={plain ? "" : undefined}
            data-open={openAll ? "" : undefined}
            onClick={() => window.innerWidth <= 760 && setTapped((t) => !t)}
          >
            <div className="rd-q-in">
              <p className="rd-q">
                {blocks.map((b, i) => (
                  <span key={i} className={b.kind === "code" ? "rd-qc" : "rd-qp"}>
                    {b.lines.map((l, k) => (
                      <span key={k} className="rd-ql">
                        {l || " "}
                      </span>
                    ))}
                  </span>
                ))}
              </p>
            </div>
          </div>
          {long && (
            <button
              type="button"
              className="rd-more"
              aria-expanded={openAll}
              onClick={() => {
                const opening = !openAll;
                setOpenAll(opening);
                // "Show less" brings the top of the message back into view
                if (!opening) requestAnimationFrame(() => root.current?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" }));
              }}
            >
              <span className="rd-more-l">{openAll ? "Show less" : "Show all"}</span>
              <span className="rd-more-n">{more ? `${more} more line${more === 1 ? "" : "s"}` : ""}</span>
              <Icon name="down" size={14} className="rd-more-c" />
            </button>
          )}
        </>
      )}
      {atts && (
        <div className="rd-atts">
          {parsed.images.map((im: MessageContent, i) => (
            <StoredImage key={i} item={im} thumb />
          ))}
          {parsed.files.map((f, i) => {
            const name = f.file?.name || "Attachment";
            const kind = /pdf/i.test(f.file?.mimeType ?? name) ? "PDF" : (name.split(".").pop() || "file").toUpperCase().slice(0, 4);
            return (
              <div className="rd-doc" key={i}>
                <span className="rd-doc-ico" aria-hidden="true">
                  <span>{kind}</span>
                </span>
                <span className="rd-doc-txt">
                  <DocName name={name} />
                  <span className="rd-doc-m">
                    {kind}
                    {f.file?.size ? ` · ${sizeOf(f.file.size)}` : ""}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="rd-mstrip" hidden={editing}>
        <div className="rd-mstrip-in">
          {vOf > 1 && <Vers at={vAt} of={vOf} go={(d) => onVersion(depth, d)} />}
          <div className="rd-tools">
            <CopyTool text={text} side="right" />
            <button type="button" className="rd-tool" onClick={() => onEdit(index)} disabled={busy} aria-label="Edit" data-tip="Edit" data-tip-side="right">
              <Icon name="edit" />
            </button>
          </div>
          <span className="rd-mstrip-when">{stamp(msg._createdAt)}</span>
        </div>
      </div>
    </article>
  );
});

/* ══ one tooltip for the whole thread: a rest delay, warm for half a second ══ */
export function Tips({ scope }: { scope: React.RefObject<HTMLElement | null> }) {
  const el = useRef<HTMLDivElement>(null);
  // the host is found after the first commit: a chat open at load mounts in
  // the same commit as .v2, so looking during render finds nothing
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector(".v2")), []);
  useEffect(() => {
    const root = scope.current;
    const tip = el.current;
    if (!root || !tip) return;
    let forBtn: HTMLElement | null = null;
    let timer = 0;
    let warm = 0;
    const show = (b: HTMLElement, now: boolean) => {
      window.clearTimeout(timer);
      const go = () => {
        forBtn = b;
        tip.textContent = b.dataset.tip ?? "";
        tip.style.left = "0px";
        tip.style.top = "0px";
        const r = b.getBoundingClientRect();
        const w = tip.offsetWidth;
        const h = tip.offsetHeight;
        let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
        let y = r.bottom + 6;
        const side = b.dataset.tipSide;
        if (side === "right") {
          x = r.right + 6;
          y = r.top + r.height / 2 - h / 2;
        } else if (side === "left") {
          x = r.left - w - 8;
          y = r.top + r.height / 2 - h / 2;
        } else if (y + h > window.innerHeight - 8) y = r.top - h - 6;
        tip.style.left = `${Math.round(x)}px`;
        tip.style.top = `${Math.round(y)}px`;
        tip.setAttribute("data-on", "");
      };
      if (now || performance.now() < warm) go();
      else timer = window.setTimeout(go, 400);
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (tip.hasAttribute("data-on")) warm = performance.now() + 500;
      tip.removeAttribute("data-on");
      forBtn = null;
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (b && b !== forBtn && !(b as HTMLButtonElement).disabled) show(b, false);
    };
    const out = (e: PointerEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (b && !b.contains(e.relatedTarget as Node)) hide();
    };
    const focus = (e: FocusEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (b?.matches(":focus-visible")) show(b, true);
    };
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", hide);
    root.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", hide);
      root.removeEventListener("scroll", hide, { capture: true });
    };
  }, [scope, host]);
  return host ? createPortal(<div className="rd-tip" role="tooltip" ref={el} />, host) : null;
}
