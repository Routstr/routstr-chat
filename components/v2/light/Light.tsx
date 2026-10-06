"use client";

import React, { useEffect, useRef, useState } from "react";
import { flowFor, lightOf } from "./flow";

export type LightState = "idle" | "typing" | "waiting" | "stream" | "done" | "error" | "offline";
export type LightPulse = { kind: "send" | "word" | "gold"; n: number } | null;

// how fast the flow drifts in each state (1 is one gentle loop a minute)
const RATE: Record<LightState, number> = { idle: 1, typing: 1.6, waiting: 1.2, stream: 6, done: 2, error: 0.6, offline: 0 };
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* An account's light. Everything that moves is transform or opacity on a layer,
   so the compositor runs it: the flow drifts (its speed follows the state), the
   light leans, breathes or glows by CSS on data-state, and a pulse sends one
   ring of light out. Still for reduced motion and while the tab is hidden. */
export default function Light({ pubkey, size, state = "idle", pulse = null }: { pubkey: string; size: number; state?: LightState; pulse?: LightPulse }) {
  const { fam, key, drift } = lightOf(pubkey);
  const [flow, setFlow] = useState("");
  const flowEl = useRef<HTMLDivElement>(null);
  const rings = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);

  // drawn once per key and size, off the first paint (the colours stand in meanwhile)
  useEffect(() => {
    const id = window.setTimeout(() => setFlow(flowFor(pubkey, Math.max(48, size * 1.5))), 0);
    return () => window.clearTimeout(id);
  }, [pubkey, size]);

  useEffect(() => {
    const el = flowEl.current;
    if (!el || reduced()) return;
    const a = el.animate(
      [{ transform: "translate(0, 0) rotate(0deg) scale(1.04)" }, { transform: `translate(${drift.dx}%, ${drift.dy}%) rotate(${drift.turn}deg) scale(1.04)` }],
      { duration: 30000, direction: "alternate", iterations: Infinity, easing: "ease-in-out" }
    );
    anim.current = a;
    const vis = () => (document.hidden ? a.pause() : a.play());
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      a.cancel();
      anim.current = null;
    };
  }, [drift.dx, drift.dy, drift.turn]);

  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    const r = RATE[state];
    if (r === 0) a.pause();
    else {
      if (!document.hidden) a.play();
      a.updatePlaybackRate(r);
    }
  }, [state]);

  // one ring of light per pulse: a soft band that fades in, spreads and fades out
  useEffect(() => {
    const host = rings.current;
    if (!pulse || !host || reduced()) return;
    const ring = document.createElement("i");
    ring.className = `lt-ring lt-${pulse.kind}`;
    host.append(ring);
    const word = pulse.kind === "word";
    const a = ring.animate(
      [
        { transform: "scale(.35)", opacity: 0 },
        { transform: "scale(.5)", opacity: word ? 0.42 : 0.7, offset: 0.15 },
        { transform: `scale(${word ? 1.1 : 1.4})`, opacity: 0 },
      ],
      { duration: word ? 1300 : 1800, easing: "cubic-bezier(.2,.7,.3,1)" }
    );
    // a ring already on its way finishes even when the next one starts
    a.onfinish = () => ring.remove();
  }, [pulse]);

  const vars = {
    width: size,
    height: size,
    "--lt-deep": fam[0],
    "--lt-body": fam[1],
    "--lt-lift": fam[2],
    "--lt-light": fam[3],
    "--lt-kx": `${key.x}%`,
    "--lt-ky": `${key.y}%`,
  } as React.CSSProperties;
  return (
    <span className="lt" data-state={state} style={vars} aria-hidden="true">
      <span className="lt-flow" ref={flowEl} style={flow ? { backgroundImage: `url(${flow})` } : undefined} />
      <span className="lt-key" />
      <span className="lt-glow" />
      <span className="lt-vig" />
      <span className="lt-rings" ref={rings} />
      <span className="lt-mute" />
      <span className="lt-rim" />
    </span>
  );
}
