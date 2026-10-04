"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useRoom, type Phase } from "../room/RoomProvider";
import { useUi } from "../ui";
import Prose from "./Prose";
import { cleanThinking, thinkingTopic } from "./content";
import { rememberOpen, rememberThinking, useSmoothText } from "./smooth";
import { tokenMs } from "../motion";

/* The answer on its way. One caret is born at send and breathes in the
   gutter, slower the longer it waits; the status line rolls to each new
   phrase in the same one-line box. When the model reasons, the window grows
   with its lines and then holds; at the first answer word the reasoning is
   drawn up into the line that names it (the fold) and the words start under
   it. Each word settles into ink once. No timers on screen. */

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The prompt named like a picture: "Paint a quiet harbour" -> "A quiet harbour". */
export const pictureName = (prompt: string) => {
  let t = prompt.trim().replace(/^(please\s+)?(paint|draw|make|create|generate|render|sketch|illustrate|design|show me)(\s+me)?\s+/i, "");
  const first = t.split(/[.!?\n,;]/)[0].trim();
  const words = first.split(/\s+/);
  t = words.length <= 12 ? first : `${words.slice(0, 9).join(" ")}…`;
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};

/** The newest reasoning heading, scanned from the end. */
const newestHeading = (s: string) => {
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) if (/^(#{1,4}\s|\*\*[^*]+\*\*$)/.test(lines[i])) return lines[i].replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 80);
  return "";
};

/** One phrase at a time in a one-line slot: a new one rolls up into it. */
function RollWords({ text, className }: { text: string; className?: string }) {
  const [items, setItems] = useState([{ key: 0, text, state: "rest" as "in" | "rest" | "out" }]);
  const n = useRef(0);
  useLayoutEffect(() => {
    if (items[items.length - 1]?.text === text) return;
    if (reduced()) return setItems([{ key: ++n.current, text, state: "rest" }]);
    const key = ++n.current;
    // a newer phrase removes any leaving one at once and rolls in over the current
    setItems((xs) => [...xs.filter((x) => x.state !== "out").map((x) => ({ ...x, state: "out" as const })), { key, text, state: "in" as const }]);
    // the inner frame can outlive a newer phrase: it settles this one only while it is still arriving
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setItems((xs) => xs.map((x) => (x.key === key && x.state === "in" ? { ...x, state: "rest" } : x)))));
    const t = window.setTimeout(() => setItems((xs) => xs.filter((x) => x.state !== "out")), tokenMs("--d-fast") + 40);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <span className={`la-slot${className ? ` ${className}` : ""}`}>
      {items.map((x) => (
        <span key={x.key} className="la-w" data-in={x.state === "in" ? "" : undefined} data-out={x.state === "out" ? "" : undefined} aria-hidden={x.state === "out" || undefined}>
          {Array.from(x.text).map((ch, i) => (
            <span key={i} className="ch" style={{ "--i": i } as React.CSSProperties}>
              {ch}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function Transcript({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        const head = /^(\*\*[^*]+\*\*|#{1,4}\s.+)$/.test(t);
        const clean = t.replace(/^#{1,4}\s/, "").replace(/\*\*/g, "");
        return (
          <span key={i} className={head ? "t-h" : "t-l"}>
            {clean}
          </span>
        );
      })}
    </>
  );
}

export default function Live({ label, prompt, onFold }: { label: string; prompt: string; onFold: (height: number, ms: number) => void }) {
  const { activeConversationId, getStreamingContentFor, getThinkingContentFor, isPaymentProcessing, selectedModel } = useChat();
  const room = useRoom();
  const ui = useUi();
  const raw = getStreamingContentFor(activeConversationId);
  const thinking = cleanThinking(getThinkingContentFor(activeConversationId));
  const makesImages = (selectedModel?.architecture?.output_modalities ?? []).includes("image");

  // the clock only chooses the words; nothing on screen counts
  const t0 = useRef(performance.now());
  const [, tick] = useState(0);
  useEffect(() => {
    if (raw || thinking) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [raw, thinking]);
  const elapsed = (performance.now() - t0.current) / 1000;

  // the fold: at the first answer word after reasoning, the window closes
  // under its line while the reasoning is drawn up into it; words wait for it
  const [fold, setFold] = useState<"none" | "folding" | "folded">("none");
  const think = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!raw || !thinking || fold !== "none") return;
    const ms = reduced() ? 0 : tokenMs("--d-move");
    onFold(think.current?.getBoundingClientRect().height ?? 0, ms);
    if (!ms) return setFold("folded");
    setFold("folding");
    const t = window.setTimeout(() => setFold("folded"), ms + 40);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!raw, !!thinking]);
  // words wait for the fold from the very first render that has them
  const held = !!raw && !!thinking && fold !== "folded";
  const content = useSmoothText(held ? "" : raw, true);

  // the tail caret breathes when the words pause
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    setIdle(false);
    if (!content) return;
    const t = window.setTimeout(() => setIdle(true), 420);
    return () => window.clearTimeout(t);
  }, [content]);

  let phase: Phase = "route";
  let verb = "";
  let slow = false;
  if (raw) phase = "stream";
  else if (thinking) {
    phase = "think";
    verb = "Thinking";
  } else if (isPaymentProcessing && elapsed < 0.9) {
    phase = "pay";
    verb = "Paying";
  } else if (elapsed < 2.6) verb = "Finding a provider";
  else {
    phase = "first";
    slow = makesImages ? elapsed >= 40 : elapsed >= 12;
    verb = makesImages ? (slow ? "Still painting" : "Painting") : slow ? "Still waiting on the provider" : "Waiting for the model";
  }
  if (thinking && fold !== "none") verb = "Thought it through";
  const topic = thinking ? (fold === "none" ? newestHeading(thinking) : thinkingTopic(thinking)) : "";

  useEffect(() => {
    room.setPhase(phase);
    if (phase === "stream") room.exhale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  useEffect(() => () => room.release(), [room]);

  // keep the reasoning with the answer it produced, for the stored answer
  useEffect(() => {
    if (raw && thinking) rememberThinking(raw, thinking);
  }, [raw, thinking]);

  // the topic sits after the verb; placed by a transform, so nothing re-lays
  // out. Set on the line, so the mark and the line's action read them too.
  const words = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const w = words.current;
    const line = w?.parentElement;
    const main = w?.querySelector<HTMLElement>(".la-main .la-w:not([data-out])");
    if (!w || !line || !main) return;
    line.style.setProperty("--after", `${Math.ceil(main.scrollWidth)}px`);
    const top = w.querySelector<HTMLElement>(".la-topic .la-w:not([data-out])");
    line.style.setProperty("--tail", `${Math.ceil(main.scrollWidth + (topic && top ? top.scrollWidth + 18 : 0))}px`);
  });

  // the live window grows with its first lines, then holds at the cap and
  // the lines rise at its floor (a pure transform, nothing below moves)
  const inner = useRef<HTMLDivElement>(null);
  const rise = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useLayoutEffect(() => {
    const r = rise.current;
    const box = inner.current;
    if (!r || !box || fold !== "none") return;
    const cap = window.innerWidth <= 760 ? 112 : 132;
    const place = () => {
      const h = r.offsetHeight;
      box.style.height = `${Math.min(h, cap)}px`;
      r.style.transform = `translateY(${Math.min(0, cap - h)}px)`;
      setFull(h > cap);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(r);
    return () => ro.disconnect();
  }, [fold, !!thinking]);

  const [reopen, setReopen] = useState(false);
  const folded = fold === "folded";
  // handing over with the reasoning open: the stored answer opens it too,
  // and takes the focus if this toggle had it (read before the DOM goes)
  const toggle = useRef<HTMLButtonElement>(null);
  const handover = useRef({ raw, reopen });
  handover.current = { raw, reopen };
  useLayoutEffect(
    () => () => {
      const h = handover.current;
      if (h.reopen && h.raw) rememberOpen(h.raw, document.activeElement === toggle.current);
    },
    []
  );
  const started = !!content;

  return (
    <div
      className="rd-msg rd-ai is-last is-live la"
      aria-live="off"
      data-phase={phase}
      data-think={thinking ? "" : undefined}
      data-folded={fold !== "none" ? "" : undefined}
      data-open-thought={reopen ? "" : undefined}
      data-slow={slow ? "" : undefined}
    >
      <div className="rd-who" aria-hidden="true">
        <span className="rd-who-n">{label}</span>
      </div>
      <div className="rd-body">
        <div className="la-stage">
          <div className="la-line" role="status" data-shimmer={phase === "first" ? "" : undefined} data-gone={!thinking && started ? "" : undefined}>
            <span className="la-mark" aria-hidden="true">
              <span className="la-caret" />
              <svg className="la-chev" viewBox="0 0 24 24">
                <path d="M10 6.5 15.5 12 10 17.5" />
              </svg>
            </span>
            <span className="la-words" ref={words} data-topic={topic ? "" : undefined}>
              <RollWords text={verb} className="la-main" />
              <span className="la-sep" aria-hidden="true" />
              <span className="la-topic">{topic && <RollWords text={topic} />}</span>
            </span>
            <button type="button" className="la-act quiet la-line-act" data-on={slow && !raw ? "" : undefined} aria-hidden={slow && !raw ? undefined : true} tabIndex={slow && !raw ? 0 : -1} onClick={() => ui.setPicker(true)}>
              Switch model
            </button>
            {folded && (
              <button
                type="button"
                className="la-toggle"
                ref={toggle}
                aria-expanded={reopen}
                aria-label={`Thought it through${topic ? `, ${topic}` : ""}. Show the reasoning`}
                onClick={() => setReopen((o) => !o)}
              />
            )}
          </div>
          {thinking && (
            <div
              className="la-think"
              ref={think}
              data-open={fold === "none" || reopen ? "" : undefined}
              data-live={!folded ? "" : undefined}
              data-full={full && !folded ? "" : undefined}
              data-folding={fold === "folding" ? "" : undefined}
            >
              <div className="la-think-clip">
                <div className="la-think-in scroll" ref={inner} style={folded ? { height: "auto" } : undefined}>
                  {!folded ? (
                    <div className="la-rise" ref={rise}>
                      <Transcript text={thinking} />
                    </div>
                  ) : (
                    <Transcript text={thinking} />
                  )}
                </div>
              </div>
            </div>
          )}
          {makesImages && !raw ? (
            <div className="la-frame" data-state="wait">
              <div className="la-frame-light" aria-hidden="true">
                <i />
              </div>
              <div className="la-dens" aria-hidden="true" />
              <div className="la-frame-t">
                <q>{pictureName(prompt)}</q>
              </div>
            </div>
          ) : (
            started && (
              <div className="la-answer">
                <Prose content={content} streaming words idle={idle} />
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
