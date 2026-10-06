"use client";

import React, { memo } from "react";
import { Icon } from "../icons";
import { cx } from "./helpers";

export type Gone = "leaving" | "gone" | "back";

// one row per chat, memoised: a streaming answer should not repaint the list
export const Row = memo(function Row({
  id,
  title,
  current,
  live,
  unread,
  gone,
  long,
  tab,
  fresh,
  titled,
  n,
}: {
  id: string;
  title: string;
  current: boolean;
  live: boolean;
  unread: boolean;
  gone?: Gone;
  long: boolean;
  tab: boolean;
  fresh: boolean;
  titled: boolean;
  n?: number;
}) {
  const leaving = gone === "leaving" || gone === "gone";
  return (
    <div
      className={cx(
        "sb-row",
        live && "is-live",
        unread && !live && "is-unread",
        leaving && "is-leaving",
        gone === "gone" && "is-gone",
        fresh && "is-new",
        titled && "is-titled"
      )}
      data-id={id}
      style={n !== undefined ? ({ "--n": n } as React.CSSProperties) : undefined}
    >
      <div className="sb-row-in">
        <div className="sb-under" aria-hidden="true">
          <Icon name="trash" size={17} />
          Delete
        </div>
        {current && <span className="sb-glide" aria-hidden="true" />}
        <button type="button" className="sb-go" tabIndex={tab ? 0 : -1} aria-current={current ? "page" : undefined} aria-keyshortcuts="Delete">
          <span className={long ? "sb-t is-long" : "sb-t"}>
            <span className="sb-tt">{title}</span>
          </span>
          {live ? <span className="sr">, answering</span> : unread ? <span className="sr">, new answer</span> : null}
        </button>
        {(live || unread) && (
          <span className="sb-mark-r" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <button type="button" className="sb-x" tabIndex={-1} aria-label={`Delete ${title}`}>
          <Icon name="trash" size={15} />
        </button>
        {gone && (
          <div className="sb-undo">
            <span className="sb-undo-t">Removed</span>
            <button type="button" className="sb-undo-b">
              Undo
              <svg className="sb-ring" viewBox="0 0 16 16" aria-hidden="true">
                <circle className="sb-ring-bg" cx="8" cy="8" r="6" />
                <circle className="sb-drain" cx="8" cy="8" r="6" pathLength={100} />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
