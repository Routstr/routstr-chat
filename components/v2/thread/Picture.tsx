"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { downloadImageFromSrc } from "@/utils/download";
import { Icon } from "../icons";
import { hostOf } from "./links";

/** An enclosure under your words: the picture at its own shape, 76px tall. */
export function Thumb({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" className="rd-thumb" ref={btn} aria-label={`Open ${alt || "the picture"}`} onClick={() => setOpen(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} src={src} alt={alt} />
      </button>
      {open && img.current && (
        <Viewer
          src={src}
          alt={alt}
          from={img.current}
          onClose={() => {
            setOpen(false);
            btn.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

/* A picture in the thread keeps its own shape on the text's left edge, never
   taller than about half the window (so its strip stays on the first
   screen). Save sits on the picture; a click opens it larger in the viewer. */
export default function Picture({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const [ar, setAr] = useState(1);
  const [open, setOpen] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <figure className={`rd-img${className ? ` ${className}` : ""}`} style={{ "--ar": ar } as React.CSSProperties}>
      <button type="button" className="rd-img-open" aria-label="Open the picture larger" ref={opener} onClick={() => setOpen(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={img}
          src={src}
          alt={alt}
          onLoad={(e) => {
            const i = e.currentTarget;
            if (i.naturalWidth && i.naturalHeight) setAr(i.naturalWidth / i.naturalHeight);
          }}
        />
      </button>
      <button type="button" className="rd-img-save" aria-label="Save picture" title="Save" onClick={() => downloadImageFromSrc(src)}>
        <Icon name="download" size={16} />
      </button>
      {open && img.current && (
        <Viewer
          src={src}
          alt={alt}
          from={img.current}
          onClose={() => {
            setOpen(false);
            opener.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </figure>
  );
}

/* A picture an answer points at on another server waits for a click: loading it would tell that
   server your address, and the link itself can carry words from the chat. */
export function RemotePicture({ src, alt }: { src: string; alt: string }) {
  const [on, setOn] = useState(false);
  if (on) return <Picture src={src} alt={alt} />;
  const host = hostOf(src);
  return (
    <button type="button" className="rd-doc rd-remote" onClick={() => setOn(true)} aria-label={`Load the picture from ${host}`}>
      <span className="rd-doc-ico" aria-hidden="true">
        <span>IMG</span>
      </span>
      <span className="rd-doc-txt">
        <span className="rd-doc-n">
          <span className="rd-doc-h">{alt || "Picture"}</span>
        </span>
        <span className="rd-doc-m">{host}</span>
      </span>
    </button>
  );
}

/* The viewer: the room itself, deep and blurred, and the picture flown out of
   the page to the middle (FLIP, transform only) and back. Desktop: a Save /
   Close bar under it. Phone: edge to edge, Close and Save as corner glyphs. */
export function Viewer({ src, alt, from, onClose }: { src: string; alt: string; from: HTMLImageElement; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const pic = useRef<HTMLImageElement>(null);
  const [on, setOn] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const closing = useRef(false);

  // where the picture lands: the middle of the window, clear of the bar
  const fit = useCallback(() => {
    const phone = window.innerWidth <= 760;
    const ar = from.naturalWidth && from.naturalHeight ? from.naturalWidth / from.naturalHeight : 1;
    const maxW = phone ? window.innerWidth : window.innerWidth - 64;
    const maxH = phone ? window.innerHeight * 0.8 : window.innerHeight - 46 - 24 - 64;
    let width = Math.min(maxW, maxH * ar);
    let height = width / ar;
    if (height > maxH) {
      height = maxH;
      width = height * ar;
    }
    const top = phone ? (window.innerHeight - height) / 2 : 32 + (maxH - height) / 2;
    return { left: (window.innerWidth - width) / 2, top, width, height };
  }, [from]);

  // fly out from the page: start drawn over the thumbnail, then let go
  const flight = (to: { left: number; top: number; width: number }) => {
    const r = from.getBoundingClientRect();
    const s = r.width / to.width;
    return `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${s})`;
  };
  useLayoutEffect(() => {
    const to = fit();
    setBox(to);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      if (pic.current && !reduce) {
        pic.current.style.transition = "none";
        pic.current.style.transform = flight(to);
        void pic.current.offsetWidth;
        pic.current.style.transition = "";
      }
      setOn(true);
      requestAnimationFrame(() => {
        if (pic.current) pic.current.style.transform = "";
        root.current?.focus({ preventScroll: true });
      });
    });
    const onResize = () => setBox(fit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setOn(false);
    if (reduce || !box || !pic.current) return onClose();
    pic.current.style.transform = flight(box);
    window.setTimeout(onClose, 330);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, onClose]);

  // Esc closes; Tab stays between Save and Close
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    if (e.key === "Tab") {
      const bs = Array.from(root.current?.querySelectorAll<HTMLElement>(".rd-vbtn") ?? []);
      if (!bs.length) return;
      const i = bs.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      bs[(i + (e.shiftKey ? -1 : 1) + bs.length) % bs.length].focus();
    }
  };
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => prev?.focus?.({ preventScroll: true });
  }, []);

  const host = typeof document !== "undefined" ? document.querySelector(".v2") ?? document.body : null;
  if (!host) return null;
  return createPortal(
    <div className="rd-viewer" role="dialog" aria-modal="true" aria-label="Picture" tabIndex={-1} ref={root} data-on={on ? "" : undefined} onKeyDown={onKey}>
      <div className="rd-viewer-scrim" onClick={close} />
      {box && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="rd-viewer-img" ref={pic} src={src} alt={alt} style={box} onClick={close} />
      )}
      <div className="rd-viewer-bar">
        <button type="button" className="rd-vbtn" data-save="" onClick={() => downloadImageFromSrc(src)} aria-label="Save picture">
          <Icon name="download" size={16} />
          <span>Save</span>
        </button>
        <button type="button" className="rd-vbtn" data-close="" onClick={close} aria-label="Close">
          <Icon name="close" size={16} />
          <span>Close</span>
        </button>
      </div>
    </div>,
    host
  );
}
