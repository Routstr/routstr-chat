"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@/types/chat";
import Prose from "../Prose";
import StoredImage from "../StoredImage";
import { parseContent } from "../content";
import { recallThinking } from "../smooth";
import { costLabel, stamp, type Go } from "../atoms/helpers";
import { CiteCard } from "./CiteCard";
import { Sources } from "./Sources";
import { Strip } from "./Strip";
import { Thought } from "./Thought";
import { useCites } from "./useCites";
import { useNotes } from "./useNotes";

/* Finished turns as a book spread: who spoke hangs in the left margin, where
   it came from hangs in the right, and the words keep one measure. Messages
   are memoised on their own props, so a streaming answer re-renders only
   itself. */

/* ══ an answer ═════════════════════════════════════════════════════════════ */
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

  useNotes(answer, sources, parsed.text);
  const { card, closeT, closeCard, soonClose, onOver, onOut, onFocusIn, onFocusOut, onClick } = useCites(root, answer, sources);

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
          {sources.length > 0 && <Sources sources={sources} />}
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
