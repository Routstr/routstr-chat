/* The first send, the composer's signature: the island lifts from the centre
   and settles into the dock carrying your words. It is laid out once, in the
   dock; only its face is drawn from where it was. Everything that moves here
   is transform or opacity, so no frame re-lays out the panel.

   takeFlight() runs before the send (while the centre is still drawn), land()
   runs right after the panel has re-laid out as a chat. settle() is the same
   shrinking top edge for a send from the dock. */

import { rootToken, tokenMs } from "../motion";

interface Words {
  node: HTMLTextAreaElement;
  x: number;
  y: number; // from the bottom of the island's inner box
  w: number;
  h: number;
  scroll: number;
  mask: string;
}
interface Ghost {
  node: HTMLElement;
  rect: DOMRect;
}
interface Flight {
  from: DOMRect;
  fromH: number;
  words: Words | null;
  ghosts: Ghost[];
  /** the first visit's pool of light (fixed in the room), which fades with the page */
  pool: HTMLElement | null;
}

let next: Flight | null = null;
let running: Animation[] = [];

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tok = rootToken;
const ms = tokenMs;
const ease = (name: string) => tok(name) || "ease";

function takeWords(isl: HTMLElement): Words | null {
  const field = isl.querySelector<HTMLTextAreaElement>(".field");
  const inner = isl.querySelector<HTMLElement>(".island-in");
  if (!field || !inner || !field.value) return null;
  const f = field.getBoundingClientRect();
  const i = inner.getBoundingClientRect();
  const node = field.cloneNode(false) as HTMLTextAreaElement;
  node.value = field.value;
  node.readOnly = true;
  node.tabIndex = -1;
  node.removeAttribute("placeholder");
  node.setAttribute("aria-hidden", "true");
  return { node, x: f.left - i.left, y: f.top - i.bottom, w: f.width, h: f.height, scroll: field.scrollTop, mask: getComputedStyle(field).maskImage };
}

function takeGhost(el: Element | null): Ghost | null {
  if (!(el instanceof HTMLElement)) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width) return null;
  const node = el.cloneNode(true) as HTMLElement;
  // it leaves the empty-stage rules behind, so it keeps the box it had
  const cs = getComputedStyle(el);
  node.style.padding = cs.padding;
  node.style.columnGap = cs.columnGap;
  node.style.justifyItems = cs.justifyItems;
  // and its alignment (a phone's first page is left-set by rules the ghost no longer meets)
  const orig = el.querySelectorAll<HTMLElement>("*");
  node.querySelectorAll<HTMLElement>("*").forEach((n, i) => {
    if (orig[i]) n.style.textAlign = getComputedStyle(orig[i]).textAlign;
  });
  node.setAttribute("aria-hidden", "true");
  node.classList.add("ghost-out");
  node.querySelectorAll<HTMLElement>("*").forEach((n) => (n.style.animation = "none"));
  return { node, rect };
}

function takePool() {
  const el = document.querySelector<HTMLElement>(".pf-pool");
  if (!el?.parentElement) return null;
  const node = el.cloneNode(false) as HTMLElement;
  node.style.animation = "none";
  return node;
}

/** Before a send from the centre: remember where everything stood. */
export function takeFlight(isl: HTMLElement) {
  if (reduced()) return;
  const panel = isl.closest(".panel");
  next = {
    from: isl.getBoundingClientRect(),
    fromH: isl.offsetHeight,
    words: takeWords(isl),
    ghosts: [takeGhost(panel?.querySelector(".stage-in") ?? null)].filter((g): g is Ghost => !!g),
    pool: takePool(),
  };
}

function cancel() {
  running.forEach((a) => a.cancel());
  running = [];
}

/** The old top edge slides down into the card: a cap of the same face, in a
 *  well clipped to the card's rounded foot, translates the height difference.
 *  At rest its rounded top matches the card, and it is removed. */
export function settle(isl: HTMLElement, fromH: number, dur: number) {
  const d = Math.round(fromH - isl.offsetHeight);
  if (reduced() || d < 2 || !dur) return;
  const r = parseFloat(getComputedStyle(isl).borderTopLeftRadius) || 0;
  const well = document.createElement("div");
  const cap = document.createElement("div");
  well.className = "capw";
  well.setAttribute("aria-hidden", "true");
  well.style.top = `${-d}px`;
  cap.className = "cap";
  cap.style.height = `${d + r + 2}px`;
  well.appendChild(cap);
  isl.insertBefore(well, isl.firstChild);
  const a = cap.animate([{ transform: "none" }, { transform: `translateY(${d}px)` }], { duration: dur, easing: ease("--e-out"), fill: "forwards" });
  a.onfinish = a.oncancel = () => well.remove();
  const field = isl.querySelector<HTMLTextAreaElement>(".field");
  if (field && !field.hasAttribute("data-hush")) {
    field.setAttribute("data-hush", "");
    const hush = field.animate([{ opacity: 1 }, { opacity: 1 }], { duration: dur });
    hush.onfinish = hush.oncancel = () => field.removeAttribute("data-hush");
    running.push(hush);
  }
  running.push(a);
  const ring = isl.querySelector(".ring");
  if (ring) running.push(ring.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: dur, easing: "linear" }));
}

/** After the panel has re-laid out as a chat: fly the island in from the centre. */
export function land(isl: HTMLElement) {
  const f = next;
  next = null;
  cancel();
  if (!f || reduced()) return;
  const panel = isl.closest<HTMLElement>(".panel");
  const inner = isl.querySelector<HTMLElement>(".island-in");
  const field = isl.querySelector<HTMLTextAreaElement>(".field");
  const slow = ms("--d-slow");
  const to = isl.getBoundingClientRect();
  const dy = f.from.bottom - to.bottom;
  const dx = f.from.left + f.from.width / 2 - (to.left + to.width / 2);
  const travel = Math.abs(dy) >= 4; // on a phone the island is already at the bottom
  const capDur = travel ? Math.round(slow * 0.86) : ms("--d-move");

  // the greeting leaves as a ghost, under the dock
  if (panel) {
    const p = panel.getBoundingClientRect();
    f.ghosts.forEach((g) => {
      Object.assign(g.node.style, {
        position: "absolute",
        zIndex: "3",
        margin: "0",
        pointerEvents: "none",
        left: `${g.rect.left - p.left}px`,
        top: `${g.rect.top - p.top}px`,
        width: `${g.rect.width}px`,
        height: `${g.rect.height}px`,
      });
      panel.appendChild(g.node);
      const a = g.node.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-10px)" }], {
        duration: ms("--d-fast"),
        easing: ease("--e-out"),
        fill: "forwards",
      });
      a.onfinish = a.oncancel = () => g.node.remove();
    });
  }

  // the room's light goes with the page, slower than the words
  const pool = f.pool;
  const host = document.querySelector(".v2");
  if (pool && host) {
    host.insertBefore(pool, host.firstChild);
    const a = pool.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms("--d-move"), easing: ease("--e-out"), fill: "forwards" });
    a.onfinish = a.oncancel = () => pool.remove();
  }

  // the words ride the settling top edge, hold a beat, then lift away
  const w = f.words;
  if (w && inner) {
    Object.assign(w.node.style, {
      position: "absolute",
      margin: "0",
      pointerEvents: "none",
      left: `${w.x}px`,
      top: `calc(100% + ${w.y}px)`,
      width: `${w.w}px`,
      height: `${w.h}px`,
      minHeight: "0",
      transition: "none",
      maskImage: w.mask && w.mask !== "none" ? w.mask : "",
    });
    inner.appendChild(w.node);
    w.node.scrollTop = w.scroll;
    const ride = Math.round(f.fromH - isl.offsetHeight);
    const dur = Math.round(ms("--d-mid") * 1.2);
    if (ride > 1)
      running.push(w.node.animate([{ transform: "none" }, { transform: `translateY(${ride}px)` }], { duration: capDur, easing: ease("--e-out"), fill: "forwards" }));
    running.push(
      w.node.animate([{ transform: "none" }, { transform: "none", offset: 0.3 }, { transform: "translateY(-6px)" }], {
        duration: dur,
        easing: ease("--e-out"),
        fill: "forwards",
        composite: "add",
      })
    );
    const a = w.node.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: dur, easing: ease("--e-out"), fill: "forwards" });
    a.onfinish = a.oncancel = () => w.node.remove();
    running.push(a);
  }

  // "Reply" waits until the island has landed, then fades in
  if (field) {
    field.setAttribute("data-hush", "");
    const hush = field.animate([{ opacity: 1 }, { opacity: 1 }], { duration: travel ? slow : capDur });
    hush.onfinish = hush.oncancel = () => field.removeAttribute("data-hush");
    running.push(hush);
  }

  settle(isl, f.fromH, capDur);
  if (!travel) return;
  // the travel glides (a turn curve, a beat longer); the bump and the shadow keep their time
  running.push(isl.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: slow + ms("--d-quick"), easing: ease("--e-turn") }));
  running.push(
    isl.animate([{ transform: "scale(1)" }, { transform: "scale(1.016)", offset: 0.2 }, { transform: "scale(1)", offset: 0.72 }, { transform: "scale(1)" }], {
      duration: slow,
      easing: "linear",
      composite: "add",
    })
  );
  const deep = isl.querySelector(".sh-deep");
  if (deep)
    running.push(deep.animate([{ opacity: 0 }, { opacity: 1, offset: 0.16 }, { opacity: 0, offset: 0.8 }, { opacity: 0 }], { duration: slow + 80, easing: "linear" }));
}
