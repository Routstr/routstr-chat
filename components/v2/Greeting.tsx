"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@/context/ChatProvider";
import { commitLine, peekLine } from "./palette/greet";
import { lastActivity, timeAgo } from "./format";


const phoneNow = () => window.matchMedia("(max-width: 760px)").matches;

/* The empty room: one line, the composer under it, nothing else that is not
   yet true. A first visit sets the line larger in the room's own light. */
/** `first` is null until the page knows whether this is a first visit */
export default function Greeting({ first, gone }: { first: boolean | null; gone: boolean }) {
  // chosen once for this page, when it is known which page this is, so the
  // palette's preview drew the same line
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    if (line || first === null) return;
    const l = peekLine(first);
    setLine(l);
    commitLine(l);
  }, [line, first]);
  const words = line ? line.split(" ") : [];

  return (
    <section className="stage" aria-label="New chat">
      <div className="stage-in">
        <h1 className="greet">
          {words.map((w, i) => (
            <span className="w" key={i} style={{ "--i": i } as React.CSSProperties}>
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </h1>
      </div>
      {first && <Pool gone={gone} />}
    </section>
  );
}

/* The room's light over the place you write, on a first visit: centred on the
   composer's axis, halfway between the greeting's top and the composer's foot.
   It lives in the room itself, under the furniture. */
function Pool({ gone }: { gone: boolean }) {
  const [host, setHost] = useState<Element | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => setHost(document.querySelector(".v2")), []);
  useLayoutEffect(() => {
    const p = el.current;
    if (!p) return;
    const place = () => {
      const g = document.querySelector(".panel .greet");
      const isl = document.querySelector(".panel .island");
      if (!g || !isl) return;
      const a = g.getBoundingClientRect();
      const b = isl.getBoundingClientRect();
      p.style.setProperty("--pool-x", `${Math.round(b.left + b.width / 2)}px`);
      // a phone keeps the light behind the greeting; wider, it sits between the greeting and the composer's foot
      p.style.setProperty("--pool-y", `${Math.round(phoneNow() ? a.top + a.height / 2 : (a.top + b.bottom) / 2)}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    const panel = document.querySelector(".panel");
    if (panel) ro.observe(panel);
    // the greeting moves when the stage reflows: the light follows it
    const stage = document.querySelector(".panel .stage");
    if (stage) ro.observe(stage);
    const isl = document.querySelector(".panel .island");
    if (isl) ro.observe(isl);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [host]);
  return host ? createPortal(<div className="pf-pool" ref={el} data-gone={gone ? "" : undefined} aria-hidden="true" />, host) : null;
}

/* Phone, a returning reader's new chat: one quiet way back to the latest
   chat, above the composer (the rail is a drawer away there). */
export function Resume() {
  const { conversations, loadConversation } = useChat();
  const latest = useMemo(() => {
    let best: (typeof conversations)[number] | null = null;
    let at = 0;
    for (const c of conversations) {
      const t = lastActivity(c);
      if (c.messages.length && t > at) {
        at = t;
        best = c;
      }
    }
    return best ? { c: best, at } : null;
  }, [conversations]);
  // a title that runs out of room fades at its end; one that fits stays whole
  const tRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const t = tRef.current;
    if (!t) return;
    const cut = () => t.toggleAttribute("data-cut", t.scrollWidth > t.clientWidth + 1);
    cut();
    const ro = new ResizeObserver(cut);
    ro.observe(t);
    return () => ro.disconnect();
  }, [latest]);
  if (!latest) return null;
  const title = latest.c.title || "Untitled";
  const when = timeAgo(latest.at);
  return (
    <button type="button" className="resume only-m" aria-label={`Continue ${title}, ${when}`} onClick={() => loadConversation(latest.c.id)}>
      <span className="resume-k">Continue</span>
      <span className="resume-t" ref={tRef}>
        {title}
      </span>
      <span className="resume-when">{when}</span>
    </button>
  );
}
