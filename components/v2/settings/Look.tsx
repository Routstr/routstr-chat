"use client";

import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { ROOMS, useRoom, type RoomId } from "../room/RoomProvider";
import { Grp, Head, Row, Sw, reducedMotion } from "./parts";

function Scene({ id }: { id: string }) {
  return (
    <span className="st-pv-scene" data-s={id}>
      <span className="st-pv-bg" />
      <span className="st-pv-rail">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="st-pv-panel">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
export default function Look() {
  const room = useRoom();
  const [still, setStill] = useState(false);
  useEffect(() => setStill(reducedMotion()), []);
  const auto = room.room === "auto";
  const real = room.resolved;
  // the room owns its cross-dissolve (and the reduced-motion check)
  const pick = (id: RoomId) => room.setRoom(id);
  const cards = ROOMS.filter((r) => r.id !== "auto");
  const box = useRef<HTMLDivElement>(null);
  const key = (e: React.KeyboardEvent) => {
    const i = cards.findIndex(
      (r) => r.id === (document.activeElement as HTMLElement)?.dataset.v
    );
    if (i < 0) return;
    const step =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowDown"
            ? 2
            : e.key === "ArrowUp"
              ? -2
              : 0;
    // off the grid's edge is nowhere: a stray arrow never repaints the room sideways
    if (!step || i + step < 0 || i + step > cards.length - 1) return;
    e.preventDefault();
    const j = i + step;
    pick(cards[j].id);
    requestAnimationFrame(() =>
      box.current
        ?.querySelector<HTMLElement>(`[data-v="${cards[j].id}"]`)
        ?.focus()
    );
  };
  return (
    <>
      <Head title="Look" />
      <Grp id="g-room" k="Room" kv={auto ? "System" : ""}>
        <Row
          id="r-follow"
          title="Follow system"
          note="Paper when your system is light, Night when it is dark. Picking a room turns this off."
        >
          <Sw
            on={auto}
            label="Follow system"
            onChange={(v) => pick(v ? "auto" : real)}
          />
        </Row>
        <div
          className="st-rooms"
          role="radiogroup"
          aria-label="Room"
          ref={box}
          onKeyDown={key}
        >
          {cards.map((r) => (
            <button
              key={r.id}
              type="button"
              className="st-roomc"
              role="radio"
              aria-checked={real === r.id}
              tabIndex={real === r.id ? 0 : -1}
              data-v={r.id}
              onClick={() => pick(r.id)}
            >
              <span className="st-sw-pv">
                <Scene id={r.id} />
                <span className="st-pv-tick">
                  <Icon name="check" size={12} />
                </span>
              </span>
              <span className="st-room-txt">
                <span className="st-room-n">{r.name}</span>
                <span className="st-room-l">
                  {r.id === "meridian" && room.hourName
                    ? `Follows the hour, now ${room.hourName.toLowerCase()}`
                    : r.line}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="st-foot" id="g-motion">
          {still
            ? "Reduced motion is on in your system, so the rooms hold still."
            : "Motion follows your system. Turn on reduced motion there and the rooms hold still."}
        </p>
      </Grp>
    </>
  );
}
