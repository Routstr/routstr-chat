"use client";

import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ROOMS, useRoom, type RoomId } from "../room/RoomProvider";
import { DayStrip } from "../room/backdrop";
import { Icon } from "../icons";
import { tokenMs } from "../motion";
import { useUi } from "../ui";

/* The room, said in words at the foot of the rail: a small round swatch of
   the room's own backdrop and its name. Its menu shows the four rooms as
   little windows onto themselves, then Follow system. */

const hourNow = () => {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
};
const nameOf = (id: RoomId) => ROOMS.find((r) => r.id === id)?.name ?? "Paper";
const shortOf = (id: RoomId) => (id === "auto" ? "System" : nameOf(id));

/** The foot button. Folded, only its swatch stays (the tip names it). */
export function RoomsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const room = useRoom();
  const id = room.room;
  return (
    <button
      type="button"
      className="sb-sw"
      data-tipk="room"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`Room: ${nameOf(id)}. Change room`}
      onClick={onToggle}
    >
      <span
        className={`sb-dot${id === "auto" ? " sw-auto" : ""}`}
        style={id === "meridian" ? { background: DayStrip.paint(hourNow()) } : undefined}
        aria-hidden="true"
      />
      <span className="sb-sw-n">{shortOf(id)}</span>
    </button>
  );
}

const TILES = ROOMS.filter((r) => r.id !== "auto");

/** The menu, placed on the rail itself so the card's clip never cuts it. */
export function RoomsMenu({ onClose }: { onClose: (refocus: boolean) => void }) {
  const room = useRoom();
  const ui = useUi();
  const box = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const here = room.room === "meridian" && room.hourName ? `Meridian · ${room.hourName}` : nameOf(room.room);
  const [line, setLine] = useState(here);

  const leave = (refocus: boolean) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose(refocus);
    window.setTimeout(() => onClose(refocus), tokenMs("--d-fast"));
  };
  const close = (refocus: boolean) => {
    setClosing(true);
    leave(refocus);
  };

  // the palette opening over it closes it: nothing stays open behind the veil
  const [palette, setPalette] = useState(false);
  if (ui.palette !== palette) {
    setPalette(ui.palette);
    if (ui.palette) setClosing(true);
  }
  useEffect(() => {
    if (ui.palette) leave(false);
  }, [ui.palette]);

  // the room you are in takes focus; the others are one arrow away
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, []);

  // outside press or Esc closes; Tab leaves and closes
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (box.current?.contains(t) || t.closest?.(".sb-sw")) return;
      close(false);
    };
    const key = (e: KeyboardEvent) => {
      // the palette over it takes its own Esc
      if (e.key !== "Escape" || ui.palette) return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [ui.palette]);

  const pick = (id: RoomId) => {
    const apply = () => flushSync(() => room.setRoom(id));
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(apply);
    else apply();
    close(true);
  };

  // a 2 x 2 grid of rooms, then one full row: the arrows move the way the eye does
  const onKey = (e: React.KeyboardEvent) => {
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>(".sb-room") ?? []);
    const i = items.indexOf(e.target as HTMLElement);
    let n: HTMLElement | undefined;
    if (e.key === "ArrowRight") n = items[Math.min(items.length - 1, i + 1)];
    if (e.key === "ArrowLeft") n = items[Math.max(0, i - 1)];
    if (e.key === "ArrowDown") n = items[i < 2 ? i + 2 : 4];
    if (e.key === "ArrowUp") n = items[i === 4 ? 2 : Math.max(0, i - 2)];
    if (e.key === "Home") n = items[0];
    if (e.key === "End") n = items[items.length - 1];
    if (e.key === "Tab") return close(false);
    if (!n) return;
    e.preventDefault();
    n.focus();
  };

  const auto = room.room === "auto";
  return (
    <div
      className="sb-rooms"
      ref={box}
      role="menu"
      aria-label="Rooms"
      data-closing={closing ? "" : undefined}
      onKeyDown={onKey}
      onPointerLeave={() => setLine(here)}
    >
      <p className="sb-rooms-t" aria-hidden="true">
        <span>Room</span>
        <span className="sb-rooms-now">{line}</span>
      </p>
      <div className="sb-rooms-grid">
        {TILES.map((r, i) => (
          <button
            key={r.id}
            type="button"
            className="sb-room"
            role="menuitemradio"
            aria-checked={room.room === r.id}
            aria-label={`${r.name}. ${r.line}`}
            tabIndex={-1}
            style={{ "--i": i } as React.CSSProperties}
            onPointerEnter={() => setLine(r.line)}
            onFocus={() => setLine(r.line)}
            onClick={() => pick(r.id)}
          >
            <span className={`room-sw sw-${r.id}`} style={r.id === "meridian" ? { background: DayStrip.paint(hourNow()) } : undefined}>
              <span className="mini-rail" data-room={r.id} />
              <span className="room-ink" data-room={r.id}>
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="sb-room-n">{r.name}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="sb-room sb-room-auto"
        role="menuitemradio"
        aria-checked={auto}
        tabIndex={-1}
        style={{ "--i": 4 } as React.CSSProperties}
        onClick={() => pick("auto")}
      >
        <span className="sb-dot sw-auto" aria-hidden="true" />
        <span className="sb-room-tx">
          <span className="sb-room-n">Follow system</span>
          <span className="sb-room-l">Paper or Night, as your system is set</span>
        </span>
        {auto ? <Icon name="check" size={15} /> : <span />}
      </button>
    </div>
  );
}
