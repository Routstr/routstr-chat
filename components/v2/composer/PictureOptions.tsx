"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import type { Model } from "@/types/models";
import { sats } from "../format";
import { Icon } from "../icons";
import { mostPictures, pictureOf } from "../picker/catalog";
import { pictureSats } from "../price";
import { usePicture } from "../ui";

const word = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Option<T> = { value: T; name: string; sats: number };

/* One of a picture's choices: a quiet button in the composer's row, and its
   menu in the top layer (no clip, no transform under it), under the button
   where it fits, else over it, and inside the window. */
function Choice<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: Option<T>[]; onPick: (v: T) => void }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const shown = options.find((o) => o.value === value) ?? options[0];
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>(".mi") ?? []);
  const place = () => {
    const b = btn.current?.getBoundingClientRect();
    const m = menu.current;
    if (!b || !m) return;
    const { innerWidth: w, innerHeight: h } = window;
    // before it opens it has no size: its rows give it (48px on a phone, 36px else)
    const tall = m.offsetHeight || 40 + options.length * (w <= 760 ? 48 : 36);
    const up = b.bottom + 6 + tall > h - 8 && b.top > h - b.bottom;
    m.toggleAttribute("data-up", up);
    m.style.left = `${Math.max(8, Math.min(b.left, w - 8 - (m.offsetWidth || 176)))}px`;
    m.style.top = up ? "auto" : `${b.bottom + 6}px`;
    m.style.bottom = up ? `${h - b.top + 6}px` : "auto";
  };
  useEffect(() => {
    if (!open) return;
    // it follows its button: the composer moves when a phone's keyboard goes
    let frame = requestAnimationFrame(function follow() {
      place();
      frame = requestAnimationFrame(follow);
    });
    // a press outside closes it; the click it becomes must not also act (Send would pay)
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || btn.current?.contains(t)) return;
      const eat = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", eat, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", eat, true), 600);
    };
    window.addEventListener("pointerdown", down, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", down, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="pic-opt"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${shown.name}`}
        onKeyDown={(e) => {
          if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || open) return;
          e.preventDefault();
          menu.current?.showPopover?.();
        }}
      >
        <span>{shown.name}</span>
        <Icon name="down" className="chev" />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={label}
        className="pic-menu"
        onBeforeToggle={(e) => e.newState === "open" && place()}
        onToggle={(e) => {
          const on = e.newState === "open";
          setOpen(on);
          if (on) items().find((i) => i.getAttribute("aria-checked") === "true")?.focus({ preventScroll: true });
        }}
        onKeyDown={(e) => {
          const all = items();
          const i = all.indexOf(document.activeElement as HTMLElement);
          const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
          if (to === undefined) return;
          e.preventDefault();
          all[(to + all.length) % all.length]?.focus();
        }}
      >
        <p className="menu-t">{label}</p>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="mi"
            role="menuitemradio"
            aria-checked={o.value === shown.value}
            tabIndex={-1}
            onClick={() => {
              onPick(o.value);
              menu.current?.hidePopover();
              btn.current?.focus({ preventScroll: true });
            }}
          >
            <span>{o.name}</span>
            <span className="mi-s">~{sats(o.sats)}</span>
            <Icon name="check" size={15} className="mi-c" />
          </button>
        ))}
      </div>
    </>
  );
}

/** A picture model's size, quality and count, where the model lists them,
 *  each with what the picture would cost. */
export function PictureOptions({ model }: { model: Model }) {
  const [picture, setPicture] = usePicture();
  const ip = model.image_pricing;
  const shown = pictureOf(model, picture);
  if (!ip || !shown) return null;
  const { resolution, quality, n } = shown;
  const most = mostPictures(model);
  const one = pictureSats(model, shown);
  return (
    <span className="pic-opts">
      {ip.resolutions.length > 1 && (
        <Choice
          label="Picture size"
          value={resolution ?? ""}
          options={ip.resolutions.map((r) => ({ value: r, name: r, sats: pictureSats(model, { ...shown, resolution: r }) * n }))}
          onPick={(r) => setPicture({ ...picture, resolution: r })}
        />
      )}
      {ip.qualities.length > 1 && (
        <Choice
          label="Picture quality"
          value={quality ?? ""}
          options={ip.qualities.map((q) => ({ value: q, name: word(q), sats: pictureSats(model, { ...shown, quality: q }) * n }))}
          onPick={(q) => setPicture({ ...picture, quality: q })}
        />
      )}
      {most > 1 && (
        <Choice
          label="How many pictures"
          value={n}
          options={Array.from({ length: most }, (_, i) => ({ value: i + 1, name: i ? `${i + 1} pictures` : "1 picture", sats: one * (i + 1) }))}
          onPick={(k) => setPicture({ ...picture, n: k })}
        />
      )}
    </span>
  );
}
