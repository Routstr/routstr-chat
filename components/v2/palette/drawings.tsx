"use client";

import React, { useEffect, useRef } from "react";
import { Icon } from "../icons";
import { sats, shortModelName, toMs } from "../format";
import { peekLine, shownLine } from "./greet";
import { F_WD, plural, reduced } from "./helpers";
import type { Ctx } from "./types";

/* the new page, drawn small: its greeting, the composer, the model, the price */
export function MiniPage({ text, ctx }: { text: string; ctx: Ctx }) {
  const m = ctx.selectedModel;
  const per = ctx.perReply(m);
  return (
    <div className="pk-minipage" aria-hidden="true">
      {/* the page Enter lands on: the one on screen when it already is a new chat */}
      <p className="pk-mini-g">{ctx.onEmpty ? shownLine() : peekLine(ctx.first)}</p>
      <div className="pk-mini">
        <p className={`pk-mini-f${text ? " has" : ""}`}>
          {text ? (
            <>
              {text}
              <i className="pk-caret" />
            </>
          ) : (
            "Ask anything"
          )}
        </p>
        <p className="pk-mini-u">
          <span className="pk-mini-m">
            {m ? ctx.glyph(m.id) : null}
            {m ? shortModelName(m.name, m.id) : "No model yet"}
          </span>
          {per > 0 && <span className="pk-mini-p">~{sats(per)} sats</span>}
          <span className="pk-mini-go" data-idle={text ? undefined : ""}>
            <Icon name="send" size={12} />
          </span>
        </p>
      </div>
    </div>
  );
}

/* one window onto the room: its swatch, large, with the furniture standing in it */
const RoomLayer = ({ id }: { id: string }) => (
  <span className="pk-win-l" data-r={id}>
    <span className={`swatch-live sw-${id}`} />
    <span className="pk-win-r" />
    <span className="pk-win-p" />
  </span>
);
// Follow system is Paper and Night at once: one room over the other, cut on a single line
export const RoomWindow = ({ id }: { id: string }) => (
  <div className="pk-win" data-auto={id === "auto" ? "" : undefined} aria-hidden="true">
    {id === "auto" ? (
      <>
        <RoomLayer id="paper" />
        <RoomLayer id="night" />
      </>
    ) : (
      <RoomLayer id={id} />
    )}
  </div>
);

/* seven days of spending, one bar per day, today in the room's colour */
export function Week({ ctx }: { ctx: Ctx }) {
  const day0 = new Date();
  day0.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => ({ t: day0.getTime() - (6 - i) * 86_400_000, s: 0, n: 0 }));
  for (const c of ctx.conversations)
    for (const m of c.messages) {
      const at = toMs(m._createdAt);
      if (!m.satsSpent || !at) continue;
      const d = days.find((x) => at >= x.t && at < x.t + 86_400_000);
      if (d) {
        d.s += m.satsSpent;
        d.n++;
      }
    }
  const max = Math.max(1, ...days.map((d) => d.s));
  const total = days.reduce((a, d) => a + d.s, 0);
  const replies = days.reduce((a, d) => a + d.n, 0);
  return (
    <div className="pk-week">
      <p className="pk-sub-t">
        <span>Last 7 days</span>
        <span className="mono">
          {sats(total)} sats · {plural(replies, "reply", "replies")}
        </span>
      </p>
      <div className="pk-bars" aria-hidden="true">
        {days.map((d, i) => (
          <span className={`pk-bar${i === 6 ? " today" : ""}`} key={d.t}>
            <i style={{ "--h": d.s ? Math.max(0.06, d.s / max).toFixed(3) : 0, "--n": i + 1 } as React.CSSProperties} />
            <b>{F_WD ? F_WD.format(d.t) : ""}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* the room with and without the sidebar; it plays once when you land on the row */
export function Schematic({ to }: { to: "on" | "off" }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = el.current;
    const p = s?.querySelector<HTMLElement>(".pk-schem-p");
    if (!s || !p) return;
    s.style.setProperty("--pw", String(p.offsetWidth));
    if (reduced()) return void s.setAttribute("data-play", "");
    const t = window.setTimeout(() => s.setAttribute("data-play", ""), 260);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="pk-schem" data-to={to} ref={el} aria-hidden="true">
      <span className="pk-schem-r">
        <i />
        <i />
        <i />
      </span>
      <span className="pk-schem-p">
        <i />
        <i />
        <i />
        <b />
      </span>
    </div>
  );
}
