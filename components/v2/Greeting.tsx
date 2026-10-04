"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@/context/ChatProvider";
import { useMoney } from "./useMoney";
import { commitLine, peekLine } from "./palette/greet";
import { lastActivity, timeAgo } from "./format";
import { tokenMs } from "./motion";

const IDEAS: [string, string][] = [
  ["learn", "Explain how ecash blinding works"],
  ["plan", "Plan three quiet days in Lisbon"],
  ["code", "Rename photos by date with a script"],
  ["write", "Draft a kind note declining a meeting"],
];

const phoneNow = () => window.matchMedia("(max-width: 760px)").matches;
const field = () => document.querySelector<HTMLTextAreaElement>(".island .field");

/* The empty room: one line, the composer under it, nothing else that is not
   yet true. A first visit sets the line larger in the room's own light, and
   says once, in plain words, how paying works. */
/** `first` is null until the page knows whether this is a first visit */
export default function Greeting({ first, gone }: { first: boolean | null; gone: boolean }) {
  const money = useMoney();
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
        {first && !money.loading && money.total <= 0 && (
          // a clip, so once it has faded (chats arrived) its space closes and the greeting settles
          <div className="pf-sub-clip" data-gone={gone ? "" : undefined}>
            <div>
              <p className="pf-sub" data-gone={gone ? "" : undefined}>
                {/* two sentences, one to a line where there is room: never a lopsided wrap */}
                <span className="pf-sub-l">
                  No account, no subscription. Each reply costs a few sats, <span className="nobr">tiny amounts of bitcoin.</span>
                </span>{" "}
                <span className="pf-sub-l">Only you hold the key to your chats.</span>
              </p>
            </div>
          </div>
        )}
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
      // the sub line is never wider than the composer it sits over
      isl.closest<HTMLElement>(".panel")?.style.setProperty("--isl-w", `${Math.round(b.width)}px`);
      // a phone keeps the light behind the greeting; wider, it sits between the greeting and the composer's foot
      p.style.setProperty("--pool-y", `${Math.round(phoneNow() ? a.top + a.height / 2 : (a.top + b.bottom) / 2)}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    const panel = document.querySelector(".panel");
    if (panel) ro.observe(panel);
    // the greeting moves when the phone's ideas fold away: the light follows it
    const stage = document.querySelector(".panel .stage");
    if (stage) ro.observe(stage);
    const isl = document.querySelector(".panel .island");
    if (isl) ro.observe(isl);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      document.querySelector<HTMLElement>(".panel")?.style.removeProperty("--isl-w");
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

/* Four ways in, under the composer, until the first chat exists. Pointing at
   one shows it in the box before you choose it; choosing puts it there. */
export function Ideas({ gone }: { gone: boolean }) {
  const { conversations, inputMessage, setInputMessage } = useChat();
  const box = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState<number | null>(null);

  // phone: a left-set list whose text edge is the composer's, measured
  useLayoutEffect(() => {
    const b = box.current;
    const f = field();
    const panel = b?.closest<HTMLElement>(".panel");
    if (!b || !f || !panel) return;
    const align = () => {
      b.style.paddingLeft = "";
      b.style.translate = "";
      panel.style.removeProperty("--pf-edge");
      if (!phoneNow()) return;
      const cs = getComputedStyle(f);
      const edge = f.getBoundingClientRect().left + parseFloat(cs.paddingLeft);
      // onto the edge from either side: a box that starts past it moves back by the difference
      // unrounded: the box's own left edge is fractional, so rounding here left the kinds 1px off
      const d = edge - b.getBoundingClientRect().left;
      // (a shift, not a margin: the box is centred, so a margin would move it only half as far)
      if (d >= 0) b.style.paddingLeft = `${d}px`;
      else b.style.translate = `${d}px 0`;
      panel.style.setProperty("--pf-edge", `${Math.round(edge - panel.getBoundingClientRect().left)}px`);
    };
    align();
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, [conversations.length]);

  // the idea pointed at, shown in the box as its placeholder
  useLayoutEffect(() => {
    const f = field();
    const island = f?.closest<HTMLElement>(".island");
    const ph = island?.querySelector<HTMLElement>(".pf-ph");
    if (!f || !island || !ph) return;
    // gone the moment there are words of your own
    if (on === null || inputMessage) {
      island.removeAttribute("data-preview");
      return;
    }
    const cs = getComputedStyle(f);
    const pr = (ph.offsetParent ?? f.parentElement)!.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    Object.assign(ph.style, {
      left: `${fr.left - pr.left + parseFloat(cs.paddingLeft)}px`,
      top: `${fr.top - pr.top + parseFloat(cs.paddingTop)}px`,
      right: `${pr.right - fr.right + parseFloat(cs.paddingRight)}px`,
      font: cs.font,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
    });
    // one idea to the next: the ghost re-enters the way it first came in, never a hard swap
    const swap = island.hasAttribute("data-preview") && ph.textContent !== IDEAS[on][1];
    ph.textContent = IDEAS[on][1];
    island.setAttribute("data-preview", "");
    if (swap && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      ph.animate([{ opacity: 0.35, transform: "translateY(2px)" }, { opacity: 0.95, transform: "none" }], {
        duration: tokenMs("--d-fast"),
        easing: getComputedStyle(document.documentElement).getPropertyValue("--e-out").trim() || "ease-out",
      });
  }, [on, inputMessage]);
  useEffect(() => () => field()?.closest(".island")?.removeAttribute("data-preview"), []);

  const use = (t: string) => {
    setOn(null);
    setInputMessage(t);
    requestAnimationFrame(() => {
      const f = field();
      if (!f) return;
      f.focus();
      f.setSelectionRange(t.length, t.length);
    });
  };
  return (
    <div
      className="pf-ideas"
      role="group"
      aria-label="Ideas"
      data-hidden={inputMessage || gone ? "" : undefined}
      data-gone={gone ? "" : undefined}
      inert={!!inputMessage || gone}
      ref={box}
    >
      {/* a clip, so on a phone the row can fold away and the greeting settles onto the composer */}
      <div className="pf-ideas-clip">
      <div className="pf-ideas-in">
        {IDEAS.map(([k, t], i) => (
          <button
            key={t}
            type="button"
            className="pf-idea"
            data-on={on === i ? "" : undefined}
            onPointerEnter={(e) => e.pointerType !== "touch" && setOn(i)}
            // leaving, the preview goes back to the idea that holds the focus, if any
            onPointerLeave={(e) => {
              // read the DOM now: the event is gone by the time React runs the updater
              const row = e.currentTarget.parentElement;
              const focused = row ? Array.from(row.children).indexOf(document.activeElement as Element) : -1;
              setOn((o) => (o !== i ? o : focused >= 0 ? focused : null));
            }}
            onFocus={() => setOn(i)}
            onBlur={() => setOn((o) => (o === i ? null : o))}
            onClick={() => use(t)}
            style={{ "--i": i } as React.CSSProperties}
          >
            <span className="pf-idea-k" aria-hidden="true">
              {k}
            </span>
            <span className="pf-idea-t">{t}</span>
          </button>
        ))}
      </div>
      </div>
    </div>
  );
}
