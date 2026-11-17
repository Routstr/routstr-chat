/* What this device remembers of gifts, here only (never published): the ones opened here, so
   opening one again says so and the wallet's history can say whom the sats came from; and the
   ones made here, so Your tokens can show their message and copy their short link again. */

const OPENED = "routstr.gifts.opened";
const MADE = "routstr.gifts.made";
const KEEP = 50;

export type Opened = { id: string; sats: number; memo?: string; at: number };
export type Made = { id: string; token: string; link: string; memo?: string; at: number };

function read<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function add<T extends { id: string }>(key: string, item: T): void {
  try {
    localStorage.setItem(key, JSON.stringify([item, ...read<T>(key).filter((x) => x.id !== item.id)].slice(0, KEEP)));
  } catch {
    // not remembered: the gift itself is unaffected
  }
}

export const openedGifts = () => read<Opened>(OPENED);
export const openedHere = (id: string) => openedGifts().find((g) => g.id === id) ?? null;
export const rememberOpened = (g: Opened) => add(OPENED, g);

export const madeGifts = () => read<Made>(MADE);
export const madeHere = (id: string) => madeGifts().find((g) => g.id === id) ?? null;
export const madeAs = (token: string) => madeGifts().find((g) => g.token === token) ?? null;
export const rememberMade = (g: Made) => add(MADE, g);

/** A note signed at its end, as Send a gift signs it ("… — Mira"), says who it is from. */
export function signed(memo?: string): { note: string; from: string | null } {
  const m = memo?.match(/^(.*) — ([^—]{1,40})$/s);
  return m ? { note: m[1], from: m[2] } : { note: memo ?? "", from: null };
}
