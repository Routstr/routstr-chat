"use client";

import React, { memo } from "react";
import { renderCompanyIcon } from "@/components/chat/model-selector/display";
import { Icon } from "../icons";
import { satUnit } from "../format";
import { fmt, makerOf, type Row } from "./catalog";

const mark = (text: string, q: string) => {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
};

const ModelRow = memo(function ModelRow({
  i,
  row,
  name,
  q,
  price,
  sub,
  short,
  fav,
  current,
  active,
  touch,
}: {
  i: number;
  row: Row;
  name: string;
  q: string;
  price: number;
  sub: React.ReactNode[];
  short: boolean;
  fav: boolean;
  current: boolean;
  touch?: boolean;
  active: boolean;
}) {
  return (
    <div
      className="row"
      role="option"
      id={`mp-opt-${i}`}
      data-i={i}
      style={{ "--n": Math.min(i, 9) } as React.CSSProperties}
      aria-selected={current}
      data-short={short ? "" : undefined}
      data-current={current ? "" : undefined}
      data-active={active ? "" : undefined}
    >
      <span className="r-g">{renderCompanyIcon(makerOf(row.model), "co-ico")}</span>
      <span className="r-main">
        <span className="r-n">{mark(name, q)}</span>
        <span className="r-s">
          {sub.map((b, k) => (
            <React.Fragment key={k}>
              {k > 0 && <span className="sep" aria-hidden="true">·</span>}
              {b}
            </React.Fragment>
          ))}
        </span>
      </span>
      <span className="r-p">
        {short && (
          <span className="r-need" title="Needs more sats to start">
            <Icon name="wallet" size={13} />
            <span className="sr">, needs more sats</span>
          </span>
        )}
        {price > 0 && (
          <>
            ~{fmt(price)}
            <span className="r-u"> {satUnit(price)}</span>
          </>
        )}
      </span>
      {fav && <span className="sr">, favorite</span>}
      <button
        className="r-star"
        type="button"
        tabIndex={-1}
        data-on={fav}
        aria-hidden={touch ? undefined : "true"}
        aria-label={touch ? (fav ? `Remove ${name} from favorites` : `Add ${name} to favorites`) : undefined}
        title={fav ? "Remove from favorites" : "Add to favorites"}
      >
        <Icon name={fav ? "starFill" : "star"} size={16} />
      </button>
      <button className="r-more" type="button" tabIndex={-1} aria-hidden={touch ? undefined : "true"} aria-label={touch ? `Details for ${name}` : undefined}>
        <Icon name="right" size={18} />
      </button>
    </div>
  );
});

export default ModelRow;
