"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import { thinkingTopic } from "../content";
import { takeOpen } from "../smooth";

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
