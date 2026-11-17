import { Fibres, HALF, type Pose, type Scene } from "./fibres";

/* The gift's light, from first frame to last, drawn over the whole app (its canvas fills the
   screen) but standing where the room's greeting stands. A cable of light crosses and winds
   into a ball of cool threads, the wrapping, with the bitcoin sign glowing faintly inside it in
   gold threads. Held, the wrapping pulls tight; held long enough it says so ("opened") and the
   page takes the sats. Then: opened, gold runs out along the wrapping from under the hand, the
   wrapping blows off and the ₿ stands there, revealed; then its gold threads pour, one after
   another, into the balance, where the sats now are, and the page's dimming lifts round them
   ("leaving"; "arrived" as the first reach it). Already opened by someone,
   there is nothing inside: the ₿ fades and the wrapping stays, empty, then goes. Kept for later,
   it rests, then goes. Then the light is gone ("done").

   It runs on the light's own thread (light.worker.ts): the page only tells it where things are,
   what the hand does and how the taking ended, so the wallet's work at that moment never stalls it. */

export type Ending = "landed" | "spent" | "kept";
/** Where things are on the page, in css px: the light's middle and radius, and the balance. */
export type Place = {
  light: { x: number; y: number; r: number };
  wallet: { x: number; y: number } | null;
};
export type ToLight =
  | {
      t: "init";
      canvas: OffscreenCanvas;
      w: number;
      h: number;
      dpr: number;
      place: Place;
      /** fewer threads on a small screen */
      small: boolean;
      reduced: boolean;
    }
  | { t: "size"; w: number; h: number; dpr: number; place: Place }
  /** the pointer, as a share of the screen from its middle (-0.5..0.5) */
  | { t: "point"; x: number; y: number }
  | { t: "press"; x: number; y: number }
  /** let go; a quick tap opens it by itself */
  | { t: "release"; tap: boolean }
  | { t: "open" }
  /** how the taking ended; "back": it could not be taken, and waits again */
  | { t: "end"; how: Ending | "back" }
  | { t: "run"; on: boolean };
/** opened: the hand held long enough; leaving: the dimming can lift; arrived: the sats reach the balance */
export type FromLight =
  | { t: "opened" }
  | { t: "leaving" }
  | { t: "arrived" }
  | { t: "done" }
  | { t: "dead" };

const HOLD_MS = 900;
/** opening by itself, a little slower than a hand would */
const AUTO_MS = 700;

export function director(post: (m: FromLight) => void): (m: ToLight) => void {
  let f: Fibres | null = null;
  let ending: Ending | null = null;
  let box = { w: 1, h: 1 };
  let place: Place = { light: { x: 0, y: 0, r: 1 }, wallet: null };
  const hand = { on: false, auto: false, h: 0, x: 0, y: 0, opened: false };
  // the after, as moments on the clock: a stage to go to (from when, over how long), or a word to the page
  let steps: { at: number; to?: number; ms?: number; say?: FromLight }[] = [];
  let tween: { from: number; to: number; t0: number; ms: number } | null = null;
  let over = false;

  let key = "";
  let set: { opening: Scene; list: Scene[] } | null = null;
  const scenes = (w: number, h: number) => {
    const now = `${w}/${h}/${ending}/${place.light.x}/${place.light.y}/${place.light.r}/${place.wallet?.x}/${place.wallet?.y}`;
    if (set && key === now) return set;
    key = now;
    const k = (2 * HALF) / h; // the light's units in a px
    const at = (p: { x: number; y: number }) => ({
      x: (p.x - w / 2) * k,
      y: (h / 2 - p.y) * k,
    });
    const { x, y } = at(place.light);
    const radius = place.light.r * k;
    const s = radius / 1.08; // the ball's own radius is 1.08
    const sign = (radius * 1.2) / 2; // the ₿ is 2 of its lanes' units tall: here a little more than the radius
    const home = place.wallet ? at(place.wallet) : { x, y: y + radius * 3 };

    const wrap: Pose = {
      form: 1,
      x,
      y,
      yaw: 0.5,
      pitch: 0.5,
      roll: -0.12,
      scale: s,
      gain: 0.32,
      pulse: 1.2,
      blur: 0.6,
      mark: 0,
    };
    const wrapHeld: Pose = {
      ...wrap,
      yaw: 2.1,
      pitch: 0.62,
      roll: -0.22,
      scale: s * 0.84,
      gain: 0.42,
      pulse: 3,
      blur: 0.35,
    };
    // blown off: it opens out past the screen and is gone
    const wrapOff: Pose = {
      ...wrapHeld,
      yaw: 3.6,
      scale: s * 2.6,
      gain: 0,
      blur: 1,
    };
    const coin: Pose = {
      form: 2,
      x,
      y,
      yaw: 0,
      pitch: 0.08,
      roll: 0,
      scale: sign,
      gain: 0.1,
      pulse: 1.2,
      blur: 0.4,
      mark: 1,
    };
    const coinHeld: Pose = {
      ...coin,
      scale: sign * 0.94,
      gain: 0.2,
      pulse: 2.6,
    };
    const coinShown: Pose = {
      ...coin,
      scale: sign * 1.3,
      gain: 0.9,
      pulse: 1.6,
      blur: 0.3,
    };
    // poured into the balance: its lit threads arc there one by one
    const coinPour: Pose = { ...coinShown, form: 3 };
    if (f)
      f.home = [(home.x - x) / coinShown.scale, (home.y - y) / coinShown.scale];
    const gone = (p: Pose): Pose => ({ ...p, gain: 0 });
    const empty = { wrap: { ...wrap, gain: 0.18, pulse: 0 }, coin: gone(coin) };

    const rest = { wrap, coin };
    const held = { wrap: wrapHeld, coin: coinHeld };
    const end = { wrap: gone(wrap), coin: gone(coin) };
    const list: Scene[] =
      ending === "landed"
        ? [
            rest,
            held,
            { wrap: wrapOff, coin: coinShown },
            { wrap: wrapOff, coin: coinPour },
            { wrap: wrapOff, coin: gone(coinPour) },
          ]
        : ending === "spent"
          ? [rest, held, empty, empty, end]
          : [rest, held, rest, rest, end];
    // the opening: one cable crosses the screen at the light's height, then winds into the wrapping
    const cable: Pose = {
      form: 0,
      x: 0,
      y,
      yaw: 0,
      pitch: 0.1,
      roll: -0.04,
      scale: (w * k * 1.1) / 9,
      gain: 0.3,
      pulse: 4,
      blur: 0.3,
      mark: 0,
    };
    set = {
      opening: { wrap: cable, coin: { ...cable, gain: 0.16, mark: 1 } },
      list,
    };
    return set;
  };

  // where the light stands, as a share of the screen from its middle
  const middle = () => ({
    x: place.light.x / box.w - 0.5,
    y: place.light.y / box.h - 0.5,
  });

  const frame = (dt: number) => {
    if (!f) return;
    const now = performance.now();
    // the hand: winds it toward held; let go early, it eases back. Its own opening plays out
    // first; a hand already down starts after it.
    if (!hand.opened && !ending && f.arrived) {
      if (hand.on || hand.auto)
        hand.h = Math.min(1, hand.h + dt / (hand.auto ? AUTO_MS : HOLD_MS));
      else hand.h = Math.max(0, hand.h - dt / 380);
      f.target = hand.h;
      if (hand.h >= 1) {
        hand.opened = true;
        post({ t: "opened" });
      }
    }
    // (kept in order of time: a later moment never holds back an earlier one)
    while (steps.length && steps[0].at <= now) {
      const step = steps.shift()!;
      if (step.say) {
        if (step.say.t === "done") {
          over = true;
          f.stop();
        }
        post(step.say);
      } else
        tween = { from: f.target, to: step.to!, t0: step.at, ms: step.ms! };
    }
    if (tween) {
      // even, so each change plays out in the open, not all at its start
      const t = Math.min(1, (now - tween.t0) / tween.ms);
      f.target = tween.from + (tween.to - tween.from) * t;
      if (t >= 1) tween = null;
    }
  };

  return (m) => {
    if (m.t === "init") {
      box = { w: m.w, h: m.h };
      place = m.place;
      f = new Fibres(
        m.canvas,
        scenes,
        m.small ? { wrap: 240, coin: 280 } : { wrap: 440, coin: 440 },
        m.reduced
      );
      if (f.dead) {
        f = null;
        return post({ t: "dead" });
      }
      f.onFrame = frame;
      f.resize(m.w, m.h, m.dpr);
      f.start();
      return;
    }
    if (!f) return;
    if (m.t === "size") {
      box = { w: m.w, h: m.h };
      place = m.place;
      f.resize(m.w, m.h, m.dpr);
    } else if (m.t === "point") {
      f.point(m.x, m.y);
      if (hand.on) Object.assign(hand, { x: m.x, y: m.y });
    } else if (m.t === "press")
      Object.assign(hand, { on: true, x: m.x, y: m.y });
    else if (m.t === "release")
      Object.assign(hand, { on: false, auto: hand.auto || m.tap });
    else if (m.t === "open") Object.assign(hand, { auto: true, ...middle() });
    else if (m.t === "run") {
      if (m.on && !over) f.start();
      else f.stop();
    } else if (m.t === "end") {
      const now = performance.now();
      if (m.how === "back") {
        Object.assign(hand, { on: false, auto: false, opened: false });
        return;
      }
      ending = m.how;
      if (m.how === "landed") {
        // from under the hand, kept on the wrapping
        const c = middle();
        const dx = (hand.x - c.x) * box.w;
        const dy = (hand.y - c.y) * box.h;
        const far = Math.hypot(dx, dy) / (place.light.r * 0.7);
        const keep = far > 1 ? 1 / far : 1;
        f.burst(c.x + (dx * keep) / box.w, c.y + (dy * keep) / box.h);
        // revealed; then into the balance as the page's dimming lifts round it
        steps = [
          { at: now, to: 2, ms: 1000 },
          { at: now + 2400, to: 3, ms: 2600 },
          { at: now + 3400, say: { t: "leaving" } },
          { at: now + 3800, say: { t: "arrived" } },
          { at: now + 5000, to: 4, ms: 300 },
          { at: now + 5500, say: { t: "done" } },
        ];
      } else
        steps = [
          { at: now, to: 2, ms: 900 },
          { at: now + 2600, say: { t: "leaving" } },
          { at: now + 2600, to: 4, ms: 1300 },
          { at: now + 4000, say: { t: "done" } },
        ];
    }
  };
}
