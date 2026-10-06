import type { Model } from "@/types/models";
import { normalizeModality } from "@/components/v2/picker/modality";
import { getModelCompanyId } from "@/components/v2/picker/modelCompanies";
import { shortModelName } from "../format";

/* The picker's words and orderings, kept free of React so they can be tested.
   Everything here reads fields the app already has on `Model`. */

/** One provider that serves a model, with that provider's own prices. */
export interface Route {
  base: string; // normalised base url, the key the app pins with
  host: string; // what people read: "api.routstr.com"
  model: Model; // the provider's own listing (its sats_pricing)
}

/** A row in the list. Favorites may pin a provider: "id@@base". */
export interface Row {
  key: string;
  model: Model;
  pin: string | null; // base url
}

export type SortKey = "latest" | "cheapest" | "context" | "coverage" | "name";
export type Scope = "favorites" | "picks" | "all" | string; // or a maker id

export const SORTS: { key: SortKey; first: string; flipped: string }[] = [
  { key: "latest", first: "Newest first", flipped: "Oldest first" },
  { key: "cheapest", first: "Cheapest first", flipped: "Priciest first" },
  { key: "context", first: "Longest context first", flipped: "Shortest context first" },
  { key: "coverage", first: "Most providers first", flipped: "Fewest providers first" },
  { key: "name", first: "A to Z", flipped: "Z to A" },
];

export const sortLabel = (key: SortKey, dir: 1 | -1) => {
  const s = SORTS.find((x) => x.key === key) ?? SORTS[0];
  return dir < 0 ? s.flipped : s.first;
};

export const sees = (m: Model) => (m.architecture?.input_modalities ?? []).some((x) => normalizeModality(x) === "image");
export const draws = (m: Model) => (m.architecture?.output_modalities ?? []).some((x) => normalizeModality(x) === "image");
export const isPrivate = (m: Model) => m.id.startsWith("tinfoil");
export const nameSaysPrivate = (m: Model) => /private/i.test(m.name);

/** Models the chat can talk to: text in, text or pictures out. */
export const answers = (m: Model) => {
  const outs = m.architecture?.output_modalities;
  const ins = m.architecture?.input_modalities;
  const out = !outs?.length || outs.map((o) => String(o ?? "").toLowerCase()).some((o) => o === "text" || o === "image");
  const inn = !ins?.length || ins.map(normalizeModality).some((i) => i === "text");
  return out && inn;
};

/** A base url as the app pins and the discovery cache keys it: with a scheme
 *  and a closing slash. */
export const baseKey = (base: string) => {
  const url = base.startsWith("http") ? base : `https://${base}`;
  return url.endsWith("/") ? url : `${url}/`;
};

/** Who serves a route, as people read it: the provider's host, else the maker
 *  from a "Maker: Name" model name. */
export function hostOf(base: string | null, model: Model): string {
  try {
    if (base) return new URL(baseKey(base)).host;
  } catch {
    // not a url: name the maker instead
  }
  const colon = model.name.indexOf(":");
  return colon < 0 ? "Unknown" : model.name.slice(0, colon).trim();
}

export const parseKey = (key: string) => {
  const i = key.indexOf("@@");
  return i < 0 ? { id: key, base: null as string | null } : { id: key.slice(0, i), base: key.slice(i + 2) };
};

/* ── numbers in words ─────────────────────────────────────────────────── */

/** A price for this message: "0.65", "7.5", "13", "1,240". */
// replies settle in whole sats, so prices show whole sats
export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** sats per token, shown per 1M tokens: "270", "0.40", "12.5". */
export const per1M = (perToken: number) => {
  const v = perToken * 1e6;
  return v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v < 10 ? 2 : 1);
};

export const ctxK = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

const sig2 = (n: number) => {
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, n))) - 1));
  return Math.round(n / p) * p;
};
/** Two significant figures, for "covers about 1,600 like it". */

/** 0.75 words a token, 500 words a page. */
export const pages = (ctx: number) => sig2(ctx * 0.0015).toLocaleString("en-US");

const DAY = 86400;
export const releasedAgo = (created: number, now = Date.now() / 1000) => {
  const d = Math.round((now - created) / DAY);
  if (d < 1) return "Today";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  const y = Math.floor(d / 365);
  return y === 1 ? "Over a year ago" : `${y} years ago`;
};
export const releasedOn = (created: number) =>
  new Date(created * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const MOD_WORD: Record<string, string> = { text: "text", image: "images", audio: "audio", video: "video" };
const andList = (a: string[]) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
// "file" is what providers call PDFs; the shared normaliser folds it into text
const word = (x: string) => (String(x).toLowerCase() === "file" ? "PDFs" : MOD_WORD[normalizeModality(x)]);
const words = (mods: readonly string[] | undefined) => andList([...new Set((mods?.length ? mods : ["text"]).map(word))]);

/** ["Text and images in", "text out"] */
export const handles = (m: Model): [string, string] => {
  const i = words(m.architecture?.input_modalities);
  return [`${i[0].toUpperCase()}${i.slice(1)} in`, `${words(m.architecture?.output_modalities)} out`];
};

/* ── search ───────────────────────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** How well a model answers a search: 0 is no match, higher is better.
 *  A name that starts with the words beats one that contains them, which
 *  beats a maker match, which beats an id-only match. */
export function searchRank(m: Model, makerLabel: string, q: string) {
  const parts = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return 1;
  const name = shortModelName(m.name, m.id).toLowerCase();
  const hay = `${m.name} ${m.id} ${makerLabel}`.toLowerCase();
  const hayN = norm(hay);
  if (!parts.every((w) => hay.includes(w) || hayN.includes(norm(w)))) return 0;
  const nq = norm(parts.join(" "));
  const nn = norm(name);
  if (nn === nq) return 6;
  if (nn.startsWith(nq)) {
    // where the typed letters end in the real name: a prefix that stops at a
    // word or number boundary ("gpt 5" -> "GPT-5") beats one that runs into
    // the middle of it ("GPT-5.5")
    let seen = 0;
    let at = name.length;
    for (let i = 0; i < name.length; i++) {
      if (/[a-z0-9]/i.test(name[i]) && ++seen === nq.length) {
        at = i + 1;
        break;
      }
    }
    const next = name[at] ?? "";
    const runsOn = /[a-z0-9]/i.test(next) || (next === "." && /[0-9]/.test(name[at + 1] ?? ""));
    return runsOn ? 4 : 5;
  }
  if (parts.every((w) => name.includes(w))) return 3;
  if (parts.every((w) => makerLabel.toLowerCase().includes(w) || name.includes(w))) return 2;
  return 1;
}

/* ── sorting ──────────────────────────────────────────────────────────── */

/** Rows missing the measure sink whichever way the sort runs; ties go A to Z. */
export function sortRows<T extends Row>(rows: T[], key: SortKey, dir: 1 | -1, measure: (r: T) => number | null) {
  const byName = (a: T, b: T) => shortModelName(a.model.name, a.model.id).localeCompare(shortModelName(b.model.name, b.model.id));
  return [...rows].sort((a, b) => {
    if (key === "name") return byName(a, b) * dir || a.key.localeCompare(b.key);
    const x = measure(a);
    const y = measure(b);
    if ((x === null) !== (y === null)) return x === null ? 1 : -1;
    if (x !== null && y !== null && x !== y) return (x - y) * dir;
    return byName(a, b) || a.key.localeCompare(b.key);
  });
}

/** The number each sort orders by, smallest first in its natural direction. */
export const measureFor = (key: SortKey, cost: (r: Row) => number, routes: (id: string) => number) => (r: Row) => {
  switch (key) {
    case "latest": {
      const c = Number(r.model.created ?? 0);
      return c > 0 ? -c : null;
    }
    case "cheapest": {
      const c = cost(r);
      return Number.isFinite(c) && c > 0 ? c : null;
    }
    case "context": {
      const c = Number(r.model.context_length ?? 0);
      return c > 0 ? -c : null;
    }
    case "coverage":
      return -routes(r.model.id);
    default:
      return null;
  }
};

/* ── where the price sits among all of them ───────────────────────────── */

export function priceScale(costs: number[]) {
  const ok = costs.filter((c) => c > 0 && Number.isFinite(c));
  if (!ok.length) return { at: () => 0.5, ticks: [] as number[] };
  const lo = Math.log10(Math.min(...ok));
  const hi = Math.log10(Math.max(...ok));
  const at = (c: number) => (hi === lo ? 0.5 : Math.max(0, Math.min(1, (Math.log10(c) - lo) / (hi - lo))));
  return {
    at,
    ticks: ok.map(at),
  };
}

export const makerOf = (m: Model) => getModelCompanyId(m);
