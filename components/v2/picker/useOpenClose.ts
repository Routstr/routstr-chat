import React, { useEffect, useRef, useState } from "react";
import { LEAVE_MS } from "./helpers";
import { useChipRef } from "../ui";

const HINTS_KEY = "routstr.picker.opens";

export function useOpenClose({
  open,
  phone,
  signedOut,
  card,
  input,
  onGone,
  onClose,
  setMenu,
}: {
  open: boolean;
  phone: boolean;
  signedOut: boolean;
  card: React.RefObject<HTMLDivElement | null>;
  input: React.RefObject<HTMLInputElement | null>;
  onGone: () => void;
  onClose: () => void;
  setMenu: (m: boolean) => void;
}) {
  const chipRef = useChipRef();
  const [shown, setShown] = useState(false);
  const [entering, setEntering] = useState(true);
  const [hints, setHints] = useState(false);
  const counted = useRef(false);
  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (!open) setShown(false);
  }

  // open: rise in, the thread steps back, focus goes to the search
  useEffect(() => {
    if (!open) return;
    // key hints on the first two opens on this device, counted once per open
    if (!counted.current) {
      counted.current = true;
      let n = 1;
      try {
        n = Number(localStorage.getItem(HINTS_KEY) || 0) + 1;
        localStorage.setItem(HINTS_KEY, String(n));
      } catch {
        // not remembered; the hints just show
      }
      setHints(!phone && n <= 2);
    }
    const raf = requestAnimationFrame(() => setShown(true));
    const t = window.setTimeout(() => setEntering(false), 420);
    const thread = document.querySelector<HTMLElement>(".panel .thread-in");
    if (thread) thread.style.opacity = phone ? ".22" : ".3";
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      if (thread) thread.style.opacity = "";
    };
  }, [open, phone]);

  // focus can only land once the card is visible: straight into the search
  // on a desktop; a phone keeps its keyboard down until you tap the field
  useEffect(() => {
    if (!shown) return;
    const target = signedOut ? card.current?.querySelector<HTMLElement>(".mp-gate .prime") : phone ? card.current : input.current;
    target?.focus({ preventScroll: true });
  }, [shown, phone, signedOut]);

  // the risen composer settles back once the card has left (the unmount below), never under the
  // fading card; a phone's sheet stays mounted, so it lets go on close
  useEffect(() => {
    if (open || !phone) return;
    document.querySelector<HTMLElement>("[data-furniture='panel']")?.removeAttribute("data-picking");
  }, [open, phone]);
  useEffect(() => () => document.querySelector<HTMLElement>("[data-furniture='panel']")?.removeAttribute("data-picking"), []);

  // close: fall back, then leave
  useEffect(() => {
    if (open) return;
    setMenu(false);
    if (phone) return;
    const t = window.setTimeout(onGone, LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [open, phone, onGone]);

  // an outside press, or focus moving outside, closes (the sheet has its own veil)
  useEffect(() => {
    if (phone || !open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || chipRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("focusin", away);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("focusin", away);
    };
  }, [phone, open, onClose]);

  const leaveCard = () => {
    onClose();
    chipRef.current?.focus({ preventScroll: true });
  };
  return { shown, entering, hints, setHints, leaveCard };
}
