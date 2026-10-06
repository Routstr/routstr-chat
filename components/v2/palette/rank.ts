import { ROOMS } from "../room/RoomProvider";

/* ── ranking: one ladder for every kind of result ──────────────────────── */
export const tokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
// how one typed word meets a text: 3 the text starts with it, 2 a word in it does, 1 it is inside a word
export function fit(text: string, t: string) {
  let best = 0;
  for (let i = text.indexOf(t); i > -1; i = text.indexOf(t, i + 1)) {
    if (i === 0) return 3;
    best = Math.max(best, /[a-z0-9]/.test(text[i - 1]) ? 1 : 2);
  }
  return best;
}
// a plural finds its word too: "rooms" meets "room", "wallets" meets "wallet"
const fitS = (text: string, t: string) => fit(text, t) || (t.length > 3 && t.endsWith("s") ? fit(text, t.slice(0, -1)) : 0);
/* 100 a label starts with it · 80 a word in a label does · 60 a hidden word
   starts with it (a synonym never beats a name you can see) · 50 inside a
   label word. A hidden word counts only where it starts, and only from three
   letters, so every result either shows its hit or starts with a word you
   would guess. Between them: 65 a settings row's own title starts with it
   ("delete" is Delete all chats), 55 a hidden word meets it only once its
   plural s is dropped ("logs" is a log, not a log in) */
export function labelScore(label: string, words: string, q: string, toks: string[], titles: string[] = [], phraseSc = 70, hiddenSc = 60) {
  const L = label.toLowerCase();
  const W = words.toLowerCase();
  if (L.startsWith(q)) return 100;
  // (from two letters: one letter meets only the names you can see)
  if (q.length > 1 && titles.some((t) => t.toLowerCase().startsWith(q))) return 65;
  // a phrase written into the hidden words ("top up") counts whole, short word and all
  // an action's phrase (70) comes before a settings row's title (65), which comes before a phrase
  // in a page's hidden words (60): "top up" is Wallet, then Payments' Top up automatically, then keys
  if (toks.length > 1 && ` ${W}`.includes(` ${q}`)) return phraseSc;
  let min = 100;
  for (const k of toks) {
    const f = fitS(L, k);
    const g = fit(W, k) >= 2 ? hiddenSc : fitS(W, k) >= 2 ? hiddenSc - 5 : 0;
    const sc = f >= 2 ? 80 : k.length > 2 && g ? g : q.length > 1 && f === 1 ? 50 : 0;
    if (!sc) return 0;
    min = Math.min(min, sc);
  }
  return min;
}
/* 90 a title starts with it · 70 a word in it does · 45 inside a word */
export function titleScore(title: string, q: string, toks: string[]) {
  const T = title.toLowerCase();
  if (T.startsWith(q)) return 90;
  let min = 90;
  for (const k of toks) {
    const f = fitS(T, k);
    const sc = f >= 2 ? 70 : q.length > 1 && f === 1 ? 45 : 0;
    if (!sc) return 0;
    min = Math.min(min, sc);
  }
  return min;
}
/** A message as words: no markdown marks, no code blocks, one line. */
export const plain = (t: string) =>
  t
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // a heading or list item keeps its words and gains the stop it lacks, so it
    // does not run into the next sentence once the lines are joined
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+(.*?)\s*$/gm, (_, t: string) => (/[.!?:;,]$/.test(t) || !t ? t : `${t}.`))
    .replace(/(\*\*|__|~~|\*|_)(?=\S)([^*_~\n]+?)\1/g, "$2")
    .replace(/\$\$?([^$]+?)\$\$?/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
/* the window opens at most three words before the hit, so only the tail is
   ever cut (by the row's own ellipsis) and the hit always shows */
export function snippet(body: string, at: number, len: number) {
  const wordStart = (i: number) => {
    while (i > 0 && !/\s/.test(body[i - 1])) i--;
    return i;
  };
  let from = wordStart(at);
  for (let n = 0; n < 3 && from > 0; n++) {
    let i = from - 1;
    while (i > 0 && /\s/.test(body[i - 1])) i--;
    from = wordStart(i);
  }
  return (from > 0 ? "…" : "") + body.slice(from, at + len + 90).replace(/\s+/g, " ");
}

export const ROOM_WORDS: Record<string, string> = {
  paper: "light day pale light mode",
  night: "dark black dark mode",
  meridian: "hour time dusk",
  overprint: "print ink blue yellow",
  auto: "follow system automatic default hour dark mode light mode",
};
/** The Rooms page: names first, then a word of the line; the room list order breaks ties. */
export const roomsFor = (q: string) => {
  const toks = tokens(q);
  const qq = q.trim().toLowerCase();
  if (!toks.length) return ROOMS.slice();
  return ROOMS.map((r, n) => ({ r, n, sc: labelScore(r.name, `${r.line} ${ROOM_WORDS[r.id] ?? ""}`, qq, toks) }))
    .filter((x) => x.sc)
    .sort((a, b) => b.sc - a.sc || a.n - b.n)
    .map((x) => x.r);
};
