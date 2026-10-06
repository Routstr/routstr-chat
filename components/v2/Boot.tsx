"use client";

import React, { useEffect, useRef, useState } from "react";
import { useConversations, useHistoryLoaded } from "@/features/history/view";
import { MARK_D } from "./icons";
import { tokenMs } from "./motion";

/* The first frame, and first light. The room paints first; after 300 ms the
   mark appears with a band of light passing over it. When the app is ready
   the band stops and fills the mark, the mark takes a breath and flies home
   to its place in the rail (the loader becomes the logo), and on a device's
   first visit the light behind it opens across the room as the dim lifts,
   settling as the pool over the place you write. Once per device; later
   cold starts get a short version. Any key or press finishes it at once. */

const KEY = "routstr.firstlight";
const MARK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'><path d='${MARK_D}'/></svg>`
)}")`;
const reducedNow = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phoneNow = () => window.matchMedia("(max-width: 760px)").matches;
const ease = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "ease";

export default function Boot({ ready, onDone, first: forceFirst }: { ready: boolean; onDone: () => void; first?: boolean }) {
  const conversations = useConversations();
  const conversationsLoaded = useHistoryLoaded();
  // a first visit waits dimmed, with a small light behind the mark. The page's head script marks
  // it on <html> before the first paint (layout.tsx), so the server's markup is the client's
  const first = useRef(false);
  const markEl = useRef<HTMLSpanElement>(null);
  const bootEl = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const bloom = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  // first light waits for the chats to load (a returning reader must not get
  // the first visit), but never long: after a moment it goes as it is
  const [settled, setSettled] = useState(false);
  if (ready && conversationsLoaded && !settled) setSettled(true);
  useEffect(() => {
    if (!ready || conversationsLoaded) return;
    const t = window.setTimeout(() => setSettled(true), 1500);
    return () => window.clearTimeout(t);
  }, [ready, conversationsLoaded]);

  // the furniture waits hidden until first light sets it down
  useEffect(() => {
    const html = document.documentElement;
    if (forceFirst !== undefined) html.toggleAttribute("data-firstlight", forceFirst);
    first.current = html.hasAttribute("data-firstlight");
    html.setAttribute("data-waking", "");
    return () => html.removeAttribute("data-waking");
  }, [forceFirst]);

  useEffect(() => {
    if (!ready || !settled) return;
    let raf = 0;
    const anims: Animation[] = [];
    let ended = false;
    // any key or press finishes it; a typed letter goes to the composer, not lost
    const hurry = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !phoneNow())
        document.querySelector<HTMLTextAreaElement>(".panel .island .field")?.focus({ preventScroll: true });
      anims.forEach((a) => a.finish());
    };
    const end = () => {
      if (ended) return;
      ended = true;
      window.removeEventListener("keydown", hurry, true);
      window.removeEventListener("pointerdown", hurry, true);
      // the layer goes first: cancelled, its mark and dim would paint one frame back at their start
      layer.current?.style.setProperty("visibility", "hidden");
      anims.forEach((a) => a.cancel());
      document.documentElement.removeAttribute("data-waking");
      document.documentElement.removeAttribute("data-firstlight");
      // the first visit is decided either way, so its wait never plays again
      if (first.current) {
        try {
          localStorage.setItem(KEY, "1");
        } catch {
          // it plays again next time; nothing else depends on it
        }
      }
      if (!phoneNow()) document.querySelector<HTMLTextAreaElement>(".panel .island .field")?.focus({ preventScroll: true });
      done.current();
    };
    const reduced = reducedNow();
    const full = !!first.current && conversationsLoaded && conversations.length === 0 && !reduced;

    // wait two frames: the app has mounted and laid out behind the veil
    raf = requestAnimationFrame(() =>
      (raf = requestAnimationFrame(() => {
        // from here the animations below hold every piece where it starts
        document.documentElement.setAttribute("data-woke", "");
        document.documentElement.removeAttribute("data-waking");
        const E = ease("--e-out");
        const S = ease("--e-spring");
        // the flight gathers speed out of the breath and settles into the brand (--e-in-out); --e-out
        // would launch it from a standstill at full speed
        const T = ease("--e-in-out");
        // the choreography is written at the room's standard pace (--d-slow 420) and follows its tokens
        const u = tokenMs("--d-slow") / 420 || 1;
        const A = (el: Element | null | undefined, kf: Keyframe[], o: KeyframeAnimationOptions & { duration: number }) => {
          if (!el) return;
          // reduced motion: nothing moves, things only fade
          const frames = reduced ? kf.map(({ transform: _t, filter: _f, ...k }) => k) : kf;
          anims.push(
            el.animate(frames, {
              fill: "both",
              ...o,
              duration: reduced ? Math.min(o.duration * u, 120) : o.duration * u,
              delay: reduced ? 0 : (o.delay ?? 0) * u,
            })
          );
        };
        const mark = markEl.current;
        const shown = !!mark && parseFloat(getComputedStyle(mark).opacity) > 0.05;
        const brand = document.querySelector<SVGElement>(".sb-brand .sb-mark svg");
        const b = brand?.getBoundingClientRect();
        const railShown = !phoneNow() && !!b && b.width > 0;
        const FLY = full ? 900 : 560;
        if (mark && shown && brand && b && railShown && !reduced) {
          // the band stops and fills the mark; the mark flies home to the rail
          const a = mark.getBoundingClientRect();
          const dx = b.left + b.width / 2 - (a.left + a.width / 2);
          const dy = b.top + b.height / 2 - (a.top + a.height / 2);
          const k = b.width / a.width;
          mark.getAnimations().forEach((x) => x.cancel());
          mark.style.opacity = "1";
          A(mark.querySelector(".pf-mark-band"), [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: E });
          A(mark.querySelector(".pf-mark-base"), [{ opacity: 0.34 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], { duration: FLY, delay: 40, easing: E });
          const to = `translate(${dx}px, ${dy}px) scale(${k})`;
          A(
            mark,
            full
              ? [
                  { transform: "none", opacity: 1, easing: E },
                  { transform: "scale(1.08)", opacity: 1, offset: 0.24, easing: T },
                  { transform: to, opacity: 1, offset: 0.95 },
                  { transform: to, opacity: 0 },
                ]
              : [{ transform: "none", opacity: 1, easing: T }, { transform: to, opacity: 1, offset: 0.94 }, { transform: to, opacity: 0 }],
            // the curve lives on the keyframe, so the fade meets the brand's last moment (no blink)
            { duration: FLY, delay: 40, easing: "linear" }
          );
          A(brand, [{ opacity: 0 }, { opacity: 0, offset: 0.92 }, { opacity: 1 }], { duration: FLY + 40, easing: "linear" });
        } else if (bootEl.current) {
          // a phone's first light has no rail to fly to: the mark rides the light out, gone as the
          // first word arrives, so there is no empty beat between them
          // (linear: it is still there as the first word comes up, no empty beat between them)
          if (full && phoneNow()) A(bootEl.current, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.12)" }], { duration: 420, easing: "linear" });
          else A(bootEl.current, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.94)" }], { duration: 160, easing: E });
        }
        // reduced motion: the bloom stays hidden (a start keyframe would flash a sheet of light)
        if (first.current && bloom.current && !reduced) {
          const lit = parseFloat(getComputedStyle(bloom.current).opacity) || 0;
          // it opens toward where it settles: the pool, on the composer's axis (the mark flies to the rail)
          const isl = document.querySelector(".panel .island")?.getBoundingClientRect();
          const lx = isl && !phoneNow() ? Math.round(isl.left + isl.width / 2 - window.innerWidth / 2) : 0;
          bloom.current.getAnimations().forEach((x) => x.cancel());
          // from the small light behind the mark to the whole room, gone as it arrives; without first
          // light (chats exist) the small light only fades where it is, never a snap
          A(
            bloom.current,
            full
              ? [
                  // it stays on the mark while the mark breathes, then opens toward the pool as the mark
                  // leaves. The curves live on the keyframes (the effect is linear), so the hold is real
                  { transform: "translateX(0px) scale(.12)", opacity: 0.9, easing: E },
                  { transform: "translateX(0px) scale(.24)", opacity: 1, offset: 0.12, easing: T },
                  { transform: `translateX(${lx}px) scale(.44)`, opacity: 0.9, offset: 0.34, easing: E },
                  { transform: `translateX(${lx}px)`, opacity: 0 },
                ]
              : [{ transform: "scale(.12)", opacity: lit }, { transform: "scale(.12)", opacity: 0 }],
            { duration: full ? 1150 : 200, delay: full ? 120 : 0, easing: full ? "linear" : E }
          );
        }
        // the dim fades on every path (reduced motion caps it at 120ms, a fade, never a jump)
        // (the hold is a real hold: linear effect, the curve on the lift)
        if (first.current && dim.current) A(dim.current, [{ opacity: 0.5 }, { opacity: 0.5, offset: full ? 0.1 : 0, easing: E }, { opacity: 0 }], { duration: full ? 1000 : 200, delay: full ? 100 : 0, easing: "linear" });
        if (full) {
          A(document.querySelector(".v2-backdrop"), [{ transform: "scale(1.045)" }, { transform: "none" }], { duration: 1500, easing: E });
          A(document.querySelector(".pf-pool"), [{ opacity: 0, transform: "scale(.7)" }, { opacity: 1, transform: "none" }], { duration: 1000, delay: 420, easing: E });
        } else {
          // the short version: the light comes up with the room, never before it or apart from the mark
          A(document.querySelector(".pf-pool"), [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: E });
        }
        A(document.querySelector(".room"), [{ opacity: 0 }, { opacity: 1 }], { duration: 1 });
        // a phone has no rail card: its head arrives with the room instead of before it
        if (phoneNow())
          A(document.querySelector(".panel > .panel-head"), [{ opacity: 0 }, { opacity: 1 }], { duration: full ? 560 : 320, delay: full ? 320 : 0, easing: E });
        else
          // the card arrives once the mark has flown past its rows (above New chat), so the logo never
          // crosses half-shown text on its way home
          A(document.querySelector("[data-furniture='rail'] .card"), [{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }], {
            duration: full ? 560 : 320,
            delay: full ? 530 : 250,
            easing: S,
          });
        // the rows under the brand fill in once the mark has landed, so it flies over an empty card.
        // A folded rail keeps them hidden: animating their opacity would show titles on the spine
        if (railShown && !reduced && mark && shown && !document.querySelector("[data-furniture='rail'][data-fold]"))
          document.querySelectorAll("[data-furniture='rail'] .card :is(.sb-new, .sb-find, .sb-list)").forEach((el) =>
            A(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: FLY * 0.9 + 40, easing: E })
          );
        document.querySelectorAll(".panel .greet .w").forEach((w, i) =>
          A(w, [{ opacity: 0, filter: "blur(10px)", transform: "translateY(12px) scale(.97)" }, { opacity: 1, filter: "blur(0px)", transform: "none" }], {
            duration: full ? 960 : 560,
            delay: (full ? 360 : 60) + i * (full ? 90 : 50),
            easing: E,
          })
        );
        A(document.querySelector(".panel .island"), [{ opacity: 0, transform: "translateY(14px) scale(.985)" }, { opacity: 1, transform: "none" }], {
          duration: full ? 620 : 360,
          delay: full ? 520 : 80,
          easing: S,
        });
        window.addEventListener("keydown", hurry, true);
        window.addEventListener("pointerdown", hurry, true);
        Promise.all(anims.map((x) => x.finished.catch(() => undefined))).then(end);
        if (!anims.length) end();
      }))
    );
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", hurry, true);
      window.removeEventListener("pointerdown", hurry, true);
    };
  }, [ready, settled]);

  return (
    <div className="pf-bootlayer" aria-hidden={ready || undefined} ref={layer}>
      <div className="pf-dim" ref={dim} />
      <div className="pf-bloom" ref={bloom} />
      <div className="pf-boot" role="status" aria-label="Opening Routstr" ref={bootEl}>
        <span className="pf-mark" ref={markEl} style={{ "--mark": MARK } as React.CSSProperties}>
          <i className="pf-mark-base" />
          <i className="pf-mark-band" />
        </span>
      </div>
    </div>
  );
}
