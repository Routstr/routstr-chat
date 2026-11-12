import type { Model } from "@/types/models";
import list from "./openrouter.json";

/* A deal: a node that sells a model for clearly less than OpenRouter's public
   price for it. The app ships a copy of OpenRouter's list
   (scripts/openrouter-list.mjs) and never asks OpenRouter itself. Prices are
   weighed three tokens read to one written, as OpenRouter blends them. The
   same list carries Artificial Analysis's Intelligence Index, so a deal is
   ranked by what it saves on how clever the model is. */

/** Less than this much off is no deal. */
export const DEAL_MIN = 0.1;

// a node may list a model without its maker's prefix: the bare name finds it when only one maker has it
function byId<T>(entries: Record<string, T>) {
  const full = new Map(Object.entries(entries));
  const bare = new Map<string, T | null>();
  for (const [id, v] of full) {
    const k = id.slice(id.indexOf("/") + 1);
    bare.set(k, bare.has(k) ? null : v);
  }
  return (id: string) => full.get(id) ?? bare.get(id.slice(id.indexOf("/") + 1)) ?? undefined;
}

// [prompt, completion], USD a token
export const listPrice = byId<number[]>(list.prices);
/** Artificial Analysis's Intelligence Index for a model, where it has one. */
export const smartsOf = byId<number>(list.intelligence);

/** How much less than the list price this listing asks (0.92 is 92% off), or null. */
export function offList(m: Model): number | null {
  const l = listPrice(m.id);
  const here = 3 * (m.pricing?.prompt ?? 0) + (m.pricing?.completion ?? 0);
  if (!l || !(here > 0)) return null;
  // to a millionth: float dust must not make 90% of the list price 9.99% off, or 80% "19%"
  const off = Math.round((1 - here / (3 * l[0] + l[1])) * 1e6) / 1e6;
  return off >= DEAL_MIN ? off : null;
}

/** "92%": never rounded up to a deal it is not. */
export const pct = (off: number) => `${Math.floor(Math.round(off * 1e6) / 1e4)}%`;

export const smarts = (n: number) => `intelligence ${Math.round(n)}`;
