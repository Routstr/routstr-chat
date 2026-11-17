"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useRoom } from "../room/RoomProvider";
import { sats as fmt } from "../format";
import type { FromLight, Place, ToLight } from "./director";
import { holdBalance } from "./hold";
import { signed } from "./records";

/** again: this gift was opened here before, so there is nothing to open. empty: its mint has no
 *  coins for the link (cut short on its way) */
export type Phase = "here" | "taking" | "landed" | "spent" | "kept" | "again" | "empty";

const buzz = (ms: number) =>
  (navigator as Navigator & { vibrate?: (n: number) => boolean }).vibrate?.(ms);
/** The room is shown: a first visit opens on the brand mark, and the gift waits behind it. */
const watchWaking = (changed: () => void) => {
  const m = new MutationObserver(changed);
  m.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-waking"],
  });
  return () => m.disconnect();
};

/** Where the light stands (above the room's own words, clear of the panel's head) and where the balance is. */
function placeOver(words: Element): Place {
  const r = words.getBoundingClientRect();
  const phone = window.innerWidth < 760;
  const above = r.top - 80 - 28; // the room between the head and the words
  const radius = Math.max(
    56,
    Math.min(phone ? window.innerWidth * 0.34 : 190, above / 2)
  );
  const bal = [".head-bal", ".sb-foot .sb-bal"]
    .map((sel) => document.querySelector(sel)?.getBoundingClientRect())
    .find((b) => b && b.width > 0 && b.right > 0 && b.left < window.innerWidth);
  return {
    light: {
      x: phone ? window.innerWidth / 2 : r.left + r.width / 2,
      y: r.top - 28 - radius,
      r: radius,
    },
    wallet: bal
      ? { x: bal.left + bal.width / 2, y: bal.top + bal.height / 2 }
      : null,
  };
}

/* A gift opens in the room itself. Its light (gift/director.ts) stands above the room's words;
   while it is up the room is dimmed under a soft vignette, darker toward the edges, so the light
   glows as it does on the landing page, and the words are drawn light over the room's own, in
   the same place. Opened, the ₿ glides into the balance as the vignette lifts, and the room is
   just the room again, its words where they were.

   The light is drawn on a thread of its own, so the wallet's work as the sats land never stalls
   it; this side only tells it where things are, what the hand does and how the taking ended. The
   room's backdrop rests meanwhile. With no light to draw (no WebGL 2 on a thread) there is no
   vignette: the words in the room, and their button, are the gift. */
/** `take` resolves true when the gift is back to waiting (it could not be taken, and may be tried again). */
/** `own`: the sender's own gift, which opening takes back. `sats`: unknown until it is opened.
 *  `failed`: the last try did not open it, and it waits again. */
export default function GiftLight({
  memo,
  sats,
  own,
  phase,
  failed,
  take,
}: {
  memo?: string;
  sats: number | null;
  own: boolean;
  phase: Phase;
  failed: boolean;
  take: () => Promise<boolean>;
}) {
  const { note, from } = signed(memo);
  // a gift opened here before has no light: only its words
  const [quiet] = useState(phase === "again");
  const words = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const light = useRef<Worker | null>(null);
  // no light here (no WebGL 2 on a thread): the words alone, opened by their button
  const [dark, setDark] = useState(false);
  const at = useRef(0);
  const [hand, setHand] = useState<"none" | "holding" | "auto">("none");
  const [scene, setScene] = useState<"in" | "out" | "gone">("in");
  // the room's words on the screen, so the scene's lie exactly over them
  const [spot, setSpot] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const host = useSyncExternalStore(
    () => () => {},
    () => document.querySelector(".v2"),
    () => null
  );
  const awake = useSyncExternalStore(
    watchWaking,
    () => !document.documentElement.hasAttribute("data-waking"),
    () => false
  );
  const room = useRoom();
  const roomNow = useRef(room);
  const takeNow = useRef(take);
  useEffect(() => {
    roomNow.current = room;
    takeNow.current = take;
  });
  const tell = (m: ToLight) => light.current?.postMessage(m);

  const opened = () => {
    buzz(18);
    void takeNow.current().then((back) => {
      if (!back) return;
      tell({ t: "end", how: "back" });
      setHand("none");
    });
  };
  const openedNow = useRef(opened);
  useEffect(() => {
    openedNow.current = opened;
  });

  // the light, from when the room is shown
  useEffect(() => {
    const el = holder.current;
    const mine = words.current;
    if (!el || !mine || !awake) return;
    const lose = () => setDark(true);
    const canvas = document.createElement("canvas");
    if (
      !("transferControlToOffscreen" in canvas) ||
      typeof Worker === "undefined"
    )
      return lose();
    el.append(canvas);
    const w = new Worker(new URL("./light.worker.ts", import.meta.url));
    light.current = w;
    const off = canvas.transferControlToOffscreen();
    const ground = () => {
      const p = placeOver(mine);
      stage.current?.style.setProperty("--gx", `${p.light.x}px`);
      stage.current?.style.setProperty("--gy", `${p.light.y}px`);
      return p;
    };
    w.postMessage(
      {
        t: "init",
        canvas: off,
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio,
        place: ground(),
        small: window.innerWidth < 760,
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      } satisfies ToLight,
      [off]
    );
    const room = roomNow.current;
    // the balance counts its new sats up as they pour in, not before
    holdBalance(true);
    let glint = 0;
    w.onmessage = (e: MessageEvent<FromLight>) => {
      if (e.data.t === "opened") openedNow.current();
      // the ₿ goes home: the vignette lifts round it
      else if (e.data.t === "leaving") setScene("out");
      else if (e.data.t === "arrived") {
        // the sats reach the balance: it counts them in, catching the gold as they land
        holdBalance(false);
        buzz(12);
        const bal = document.querySelectorAll(".head-bal, .sb-foot .sb-bal");
        bal.forEach((b) => b.setAttribute("data-glint", ""));
        glint = window.setTimeout(
          () => bal.forEach((b) => b.removeAttribute("data-glint")),
          1200
        );
      } else if (e.data.t === "done") {
        holdBalance(false);
        room.release();
        setScene("gone");
      } else if (e.data.t === "dead") {
        lose();
        holdBalance(false);
        room.release();
      }
    };
    // the room holds still under the light
    room.exhale();
    // the room moves (a window resized, the words reflowed): the light and its words follow
    const follow = () => {
      const r = mine.getBoundingClientRect();
      setSpot({ left: r.left, top: r.top, width: r.width });
      w.postMessage({
        t: "size",
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio,
        place: ground(),
      } satisfies ToLight);
    };
    const moved = new ResizeObserver(follow);
    moved.observe(mine);
    window.addEventListener("resize", follow);
    const onPointer = (e: PointerEvent) =>
      w.postMessage({
        t: "point",
        x: e.clientX / window.innerWidth - 0.5,
        y: e.clientY / window.innerHeight - 0.5,
      } satisfies ToLight);
    const onShow = () =>
      w.postMessage({ t: "run", on: !document.hidden } satisfies ToLight);
    window.addEventListener("pointermove", onPointer);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      w.terminate();
      holdBalance(false);
      window.clearTimeout(glint);
      document
        .querySelectorAll("[data-glint]")
        .forEach((b) => b.removeAttribute("data-glint"));
      light.current = null;
      canvas.remove();
      moved.disconnect();
      window.removeEventListener("resize", follow);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onShow);
      room.release();
    };
  }, [awake, host]);

  // how the taking ended: the light plays it out, then says it is done (a link with no gift as a spent one)
  useEffect(() => {
    const how = phase === "empty" ? "spent" : phase;
    if (how === "landed" || how === "spent" || how === "kept")
      light.current?.postMessage({ t: "end", how } satisfies ToLight);
  }, [phase]);

  const share = (e: React.PointerEvent) => ({
    x: e.clientX / window.innerWidth - 0.5,
    y: e.clientY / window.innerHeight - 0.5,
  });
  const press = (e: React.PointerEvent) => {
    if (phase !== "here" || hand !== "none") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    at.current = performance.now();
    tell({ t: "press", ...share(e) });
    buzz(6);
    setHand("holding");
  };
  const release = () => {
    if (hand !== "holding") return;
    // a quick tap opens it by itself
    const tap = performance.now() - at.current < 220;
    tell({ t: "release", tap });
    setHand(tap ? "auto" : "none");
  };
  const open = () => {
    if (phase !== "here" || hand !== "none") return;
    setHand("auto");
    if (dark) opened();
    else tell({ t: "open" });
  };

  // nothing left to open here
  const over = phase === "spent" || phase === "empty";
  const n = fmt(sats ?? 0);
  const line =
    phase === "spent"
      ? "Someone opened this already."
      : phase === "empty"
        ? "This link has no gift in it."
        : phase === "again"
        ? "You opened this already."
        : phase === "kept"
          ? `Kept ${n} sats.`
          : phase === "landed"
            ? own
              ? `${n} sats, back with you.`
              : `${n} sats, yours.`
            : own
              ? "Your gift for a friend."
              : from
                ? `${from} sent you a gift.`
                : "A gift for you.";
  // with the light, held; without it, the button alone
  const act = failed
    ? ["Hold to try again", "Try again"]
    : own
      ? ["Hold to take it back", "Take it back"]
      : ["Hold to open", "Open the gift"];
  const hint =
    phase === "again"
      ? sats
        ? `The ${n} sats are in your wallet`
        : "Its sats are in your wallet"
      : phase === "kept"
        ? "They land when the mint answers"
        : phase === "landed"
          ? own
            ? "Back in your wallet"
            : from
              ? `From ${from} · ask anything below`
              : "Ask anything below"
          : phase === "taking" || hand === "auto"
            ? "Opening"
            : hand === "holding"
              ? "Keep holding"
              : act[dark ? 1 : 0];
  const asker = from ?? "whoever sent it";
  const why =
    phase === "spent"
      ? `A gift link opens once. Ask ${asker} for a new one.`
      : phase === "empty"
        ? `It may have been cut short on its way. Ask ${asker} to send it again.`
        : phase === "here" && failed
          ? "It did not open just now. Try again in a moment."
          : null;
  const said = (
    <>
      <Greet line={line} />
      {why ? (
        <p className="gift-note gift-why" key={why}>
          {why}
        </p>
      ) : (
        note && <p className="gift-note">“{note}”</p>
      )}
    </>
  );

  return (
    <div className="gift" data-phase={phase} ref={words}>
      {awake && (
        <>
          {said}
          {phase === "here" ? (
            <button
              type="button"
              className="gift-hint"
              onClick={open}
              disabled={hand !== "none"}
            >
              {hint}
            </button>
          ) : (
            !over && (
              <p className="gift-hint" role="status">
                {hint}
              </p>
            )
          )}
        </>
      )}
      {host &&
        !quiet &&
        scene !== "gone" &&
        createPortal(
          <div
            className="gift-scene"
            ref={stage}
            data-phase={phase}
            data-dead={dark ? "" : undefined}
            data-out={scene === "out" ? "" : undefined}
            onPointerDown={press}
            onPointerUp={release}
            onPointerCancel={release}
            onContextMenu={(e) => e.preventDefault()}
            aria-hidden="true"
          >
            <div className="gift-scene-dim" />
            <div className="gift-scene-light" ref={holder} />
            {awake && spot && (
              <div
                className="gift gift-scene-words"
                data-phase={phase}
                style={spot}
              >
                {said}
                {!over && <p className="gift-hint">{hint}</p>}
              </div>
            )}
          </div>,
          host
        )}
    </div>
  );
}

function Greet({ line }: { line: string }) {
  const words = line.split(" ");
  return (
    <h1 className="greet" key={line}>
      {words.map((w, i) => (
        <span className="w" key={i} style={{ "--i": i } as React.CSSProperties}>
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </h1>
  );
}
