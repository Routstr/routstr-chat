"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTheme } from "next-themes";
import { Backdrop } from "./backdrop";
import { panelBox } from "../furniture";

export type RoomId = "auto" | "paper" | "night" | "meridian" | "overprint";
type ResolvedRoom = Exclude<RoomId, "auto">;

/** How close an answer is. Leans the room's light toward the panel. */
export type Phase = "idle" | "pay" | "route" | "first" | "think" | "stream";

const PULL: Record<Phase, number> = {
  idle: 0,
  pay: 0.3,
  route: 0.6,
  first: 0.9,
  think: 1,
  stream: 0.85,
};

export const ROOMS: { id: RoomId; name: string; line: string }[] = [
  { id: "auto", name: "Follow system", line: "Paper or Night, as your system is set" },
  { id: "paper", name: "Paper", line: "Pale sage stock, nearly still" },
  { id: "night", name: "Night", line: "Ink moving in deep water" },
  { id: "meridian", name: "Meridian", line: "The room follows the hour" },
  { id: "overprint", name: "Overprint", line: "Two inks on uncoated stock" },
];

const STORAGE_KEY = "routstr.room";
// a furniture move (--d-move, 320ms, with its spring) is over well inside this
const RIDE_MS = 600;

interface RoomContextValue {
  room: RoomId;
  setRoom: (room: RoomId) => void;
  setPhase: (phase: Phase) => void;
  exhale: () => void;
  release: () => void;
  /** Re-measure where the furniture stands (overprint seams). */
  measure: () => void;
  hourName: string;
  /** The room in use: Follow system resolves to Paper or Night. */
  resolved: Exclude<RoomId, "auto">;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export const useRoom = () => {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used inside RoomProvider");
  return ctx;
};

const readStored = (): RoomId => {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as RoomId | null;
    if (v && ROOMS.some((r) => r.id === v)) return v;
  } catch {
    // storage can be blocked; the default room still works
  }
  return "auto";
};

const hourNow = () => {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
};

const faceFor = (h: number) => (h >= 6 && h < 18 ? "day" : "dusk");

const systemDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

const resolve = (room: RoomId, prefersDark: boolean): ResolvedRoom =>
  room === "auto" ? (prefersDark ? "night" : "paper") : room;

const isDark = (room: ResolvedRoom, hour: number) =>
  room === "night" || (room === "meridian" && faceFor(hour) === "dusk");

// Write the room onto <html>. Everything you read is right in this one frame.
const paint = (room: ResolvedRoom, hour: number) => {
  const html = document.documentElement;
  html.dataset.room = room;
  if (room === "meridian") html.dataset.face = faceFor(hour);
  else delete html.dataset.face;
  const meta = document.querySelector('meta[name="theme-color"]');
  const tone = getComputedStyle(html).getPropertyValue("--meta-theme").trim();
  if (meta && tone) meta.setAttribute("content", tone);
};

export function RoomProvider({ children }: { children: React.ReactNode }) {
  // read on the client's first render, so the first paint is already right
  const client = typeof window !== "undefined";
  const [room, setRoomState] = useState<RoomId>(() => (client ? readStored() : "auto"));
  const roomNow = useRef(room);
  useLayoutEffect(() => {
    roomNow.current = room;
  });
  const [prefersDark, setPrefersDark] = useState(() => client && systemDark());
  const [hour, setHour] = useState(() => (client ? hourNow() : 12));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backdropRef = useRef<Backdrop | null>(null);
  const first = useRef(true);

  const resolved = resolve(room, prefersDark);

  // follow the system scheme and the clock
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setPrefersDark(mq.matches);
    mq.addEventListener("change", onScheme);
    const tick = window.setInterval(() => setHour(hourNow()), 60_000);
    return () => {
      mq.removeEventListener("change", onScheme);
      window.clearInterval(tick);
    };
  }, []);

  // The backdrop lives for the life of the app. Created before the room
  // effect below runs, so its first paint already has a light to draw.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const b = new Backdrop(canvas);
    backdropRef.current = b;
    if (b.dead) {
      document.documentElement.dataset.nogl = "";
      return;
    }
    b.still = new URLSearchParams(window.location.search).get("still") === "1";
    const onResize = () => b.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      b.destroy();
      backdropRef.current = null;
    };
  }, []);

  // Room or face changed: the furniture flips in one frame, the light
  // arrives behind it over about a second ("late weather").
  useLayoutEffect(() => {
    const b = backdropRef.current;
    const apply = () => {
      paint(resolved, hour);
      b?.setHour(hour);
      b?.setRoom(!first.current);
    };
    if (first.current) {
      apply();
      b?.start();
      first.current = false;
      return;
    }
    apply();
  }, [resolved, hour]);

  // one cross-dissolve at a time: a room picked while one plays waits for it (only the latest
  // pick), since starting another would skip the running one to its end mid-fade
  const fading = useRef(false);
  const queued = useRef<RoomId | null>(null);
  const setRoom = useCallback((next: RoomId) => {
    // the latest pick always wins: while a fade plays it replaces any waiting pick (the room the fade
    // ends on drops it); already there, it only clears what was waiting
    if (fading.current) {
      queued.current = next;
      return;
    }
    if (next === roomNow.current) {
      queued.current = null;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not remembered, still applied
    }
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The furniture cross-dissolves as one picture (composited, cheap), so
    // nothing, not even the composer, snaps between light and dark.
    if (doc.startViewTransition && !reduce) {
      document.documentElement.dataset.roomChange = "";
      fading.current = true;
      const t = doc.startViewTransition(() => {
        paint(resolve(next, systemDark()), hourNow());
        setRoomState(next);
      }) as { finished?: Promise<void> };
      const done = () => {
        delete document.documentElement.dataset.roomChange;
        fading.current = false;
        const q = queued.current;
        queued.current = null;
        if (q && q !== next) setRoomRef.current(q);
      };
      if (t.finished) t.finished.finally(done);
      else done();
    } else {
      setRoomState(next);
    }
  }, []);
  const setRoomRef = useRef(setRoom);

  // The older panels still read light or dark from next-themes' class; keep
  // it in step with the room so their dark: styles agree with the light.
  const { setTheme } = useTheme();
  const darkNow = isDark(resolved, hour);
  useEffect(() => {
    setTheme(darkNow ? "dark" : "light");
  }, [darkNow, setTheme]);

  const measure = useCallback(() => {
    const b = backdropRef.current;
    if (!b || b.dead) return;
    const rail = document.querySelector<HTMLElement>("[data-furniture='rail']");
    const panel = document.querySelector<HTMLElement>("[data-furniture='panel']");
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 760) {
      // phone: the warm plate sits under the island, the seam above it
      const dock = document.querySelector<HTMLElement>("[data-furniture='dock']");
      const y = dock ? dock.getBoundingClientRect().top - 10 : h * 0.78;
      b.setSeam(1 - y / h, 2, 0.01, true);
      return;
    }
    // what you see of each: the rail's shade narrows with the fold, the panel runs on under the card
    const railBox = rail?.querySelector<HTMLElement>(".sb-shade") ?? rail;
    const railRight = railBox && railBox.offsetWidth > 0 ? railBox.getBoundingClientRect().right : 0;
    const box = panel ? panelBox(panel) : null;
    const x0 = box ? (railRight + box.left) / 2 / w : 0.2;
    const x1 = box ? Math.min(1.2, (box.right + w) / 2 / w + 0.02) : 1.2;
    b.setSeam(x0, x1, 0.008, false);
  }, []);

  useEffect(() => {
    if (resolved !== "overprint") return;
    measure();
    // the furniture moves by CSS transitions (the rail folds, the panel opens out): the seams ride
    // along frame by frame while one runs, so the plates never land after the furniture
    let until = 0;
    let raf = 0;
    const ride = () => {
      measure();
      raf = performance.now() < until ? requestAnimationFrame(ride) : 0;
    };
    const run = (e: TransitionEvent) => {
      if (!(e.target as Element | null)?.closest?.("[data-furniture]")) return;
      until = Math.max(until, performance.now() + RIDE_MS);
      if (!raf) raf = requestAnimationFrame(ride);
    };
    window.addEventListener("resize", measure);
    document.addEventListener("transitionrun", run);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      document.removeEventListener("transitionrun", run);
    };
  }, [resolved, measure]);

  const value = useMemo<RoomContextValue>(
    () => ({
      room,
      setRoom,
      setPhase: (p) => backdropRef.current?.setPull(PULL[p]),
      exhale: () => backdropRef.current?.exhale(),
      release: () => backdropRef.current?.release(),
      measure,
      resolved: resolved as Exclude<RoomId, "auto">,
      hourName: resolved === "meridian" ? hourLabel(hour) : "",
    }),
    [room, resolved, hour, setRoom, measure]
  );

  return (
    <RoomContext.Provider value={value}>
      <canvas ref={canvasRef} className="v2-backdrop" aria-hidden="true" />
      <div className="v2-light" aria-hidden="true" />
      {children}
    </RoomContext.Provider>
  );
}

function hourLabel(h: number) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
