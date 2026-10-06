"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@/types/chat";
import { getTextFromContent } from "@/utils/messageUtils";
import { Icon } from "../../icons";
import { parseContent } from "../content";
import { CopyTool } from "../atoms/CopyTool";
import { reduced, stamp, type Go } from "../atoms/helpers";
import { Roll } from "../atoms/Roll";
import { Vers } from "../atoms/Vers";
import { Attachments } from "./Attachments";
import { Edit } from "./Edit";
import { qBlocks } from "./qBlocks";
import { useClamp } from "./useClamp";
import { useHug } from "./useHug";

/* ══ your message ══════════════════════════════════════════════════════════ */
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
  const [tapped, setTapped] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);

  const more = useClamp(wrap, long, text);
  useHug(wrap, text);

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
      {atts && <Attachments parsed={parsed} />}
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
