import { withBase } from "@/lib/base";
import { DEFAULT_MINT_URL } from "@/lib/utils";

/** Puts this query in the address bar without a navigation. Next follows the
 *  browser's own history calls (useSearchParams updates); its router would ask
 *  for the page again, which under a base path (/v2) is a file outside the base,
 *  so a full reload. The hash stays. */
export function showQuery(query: string): void {
  window.history.replaceState(null, "", `${query ? `?${query}` : window.location.pathname}${window.location.hash}`);
}

/** A gift a link brought: its seed, its mint and its message. `id` names it on this device, to
 *  know a gift already opened here. */
export type GiftRef = { id: string; seed: Uint8Array; mint: string; memo?: string };

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** A gift as a short link: its seed, its mint (left out when it is the default mint, https://
 *  left off otherwise) and its message, packed so the link does not read it out before it is
 *  opened; all after the /gift page's #, which the browser never sends to a server. */
export function giftLink(g: { seed: Uint8Array; mint: string; memo?: string }): string {
  const p = new URLSearchParams({ s: b64(g.seed) });
  if (g.mint !== DEFAULT_MINT_URL) p.set("m", g.mint.replace(/^https:\/\//, ""));
  if (g.memo) p.set("n", b64(new TextEncoder().encode(g.memo)));
  // a mint's / and : read as they are: both are plain in a #
  return `${window.location.origin}${withBase("/gift")}#${String(p).replace(/%2F/gi, "/").replace(/%3A/gi, ":")}`;
}

/** The name a seed's gift goes by on this device. */
export const giftId = (seed: Uint8Array) => b64(seed);

/** A link's message; one that does not unpack (the link cut short) is left out, and the gift still opens. */
function unpacked(n: string | null): string | undefined {
  try {
    return n ? new TextDecoder("utf-8", { fatal: true }).decode(unb64(n)) : undefined;
  } catch {
    return undefined;
  }
}

/** The gift the address holds, if any: at the default mint when the link names none. */
export function giftIn(): GiftRef | null {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const s = p.get("s");
  const m = p.get("m");
  if (!s) return null;
  try {
    const mint = !m ? DEFAULT_MINT_URL : /^https?:\/\//.test(m) ? m : `https://${m}`;
    return { seed: unb64(s), mint, id: s, memo: unpacked(p.get("n")) };
  } catch {
    return null;
  }
}

/** Takes the gift out of the address once it is taken: back to the app's own page, its query kept. */
export function dropGift(): void {
  window.history.replaceState(null, "", `${withBase("/")}${window.location.search}`);
}
