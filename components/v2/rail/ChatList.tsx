"use client";

import React from "react";
import type { groupByDay } from "../format";
import { cx } from "./helpers";
import { Row, type Gone } from "./Row";

export function ChatList({
  finding,
  none,
  groups,
  gone,
  arriving,
  titled,
  arrivingList,
  activeConversationId,
  liveId,
  unread,
  long,
  tabId,
}: {
  finding: boolean;
  none: boolean;
  groups: ReturnType<typeof groupByDay>;
  gone: Map<string, Gone>;
  arriving: Set<string>;
  titled: Set<string>;
  arrivingList: boolean;
  activeConversationId: string | null;
  liveId: string | null;
  unread: Set<string>;
  long: Set<string>;
  tabId: string | null;
}) {
  /* ── what the rail says ─────────────────────────────────────────────── */
  let body: React.ReactNode;
  if (finding) {
    body = (
      <div className="sb-finding" aria-busy="true">
        <h2 className="sb-grp-t">
          <span className="sb-shim">Finding your chats</span>
        </h2>
        {[78, 60, 70, 52, 66, 46, 58, 40].map((w, i) => (
          <div key={i} className="sb-ghost" style={{ "--i": i } as React.CSSProperties}>
            <i style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    );
  } else if (none) {
    body = (
      <div className="sb-empty">
        <h2 className="sb-grp-t">No chats yet</h2>
      </div>
    );
  } else {
    let k = 0;
    body = groups.map((g, gi) => {
      const allGone = g.items.every((c) => gone.get(c.id) === "gone");
      const newGroup = g.items.every((c) => arriving.has(c.id));
      return (
        <section
          key={g.label}
          className={cx("sb-grp", allGone && "is-gone", newGroup && "is-new")}
          data-first={gi === 0 ? "" : undefined}
          aria-labelledby={`sbg-${gi}`}
        >
          <div className="sb-grp-in">
            <h2 className="sb-grp-t" id={`sbg-${gi}`}>
              {g.label}
            </h2>
            {g.items.map((c) => (
              <Row
                key={c.id}
                id={c.id}
                title={c.title || "Untitled"}
                current={c.id === activeConversationId}
                live={liveId === c.id}
                unread={unread.has(c.id)}
                gone={gone.get(c.id)}
                long={long.has(c.id)}
                tab={c.id === tabId}
                fresh={arriving.has(c.id)}
                titled={titled.has(c.id)}
                n={arrivingList ? Math.min(k++, 14) : undefined}
              />
            ))}
          </div>
        </section>
      );
    });
  }
  return body;
}
