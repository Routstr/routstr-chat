"use client";

import React, { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import type { Conversation, Message } from "@/types/chat";
import type { Model } from "@/types/models";
import { getModelCompanyId } from "@/components/chat/modelCompanies";
import { renderCompanyIcon } from "@/components/chat/model-selector/display";
import { Icon, type IconName } from "../icons";
import { useUi, type SettingsSection } from "../ui";
import { ROOMS, useRoom, type RoomId } from "../room/RoomProvider";
import { lastActivity, sats, shortModelName, textOf, toMs } from "../format";
import { useMoney } from "../useMoney";
import { estimateSats, promptTokens } from "../price";
import { panelBox } from "../furniture";
import { tokenMs } from "../motion";
import { INDEX, SECTIONS, showConsole } from "../settings/Settings";
import { peekLine, shownLine } from "./greet";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/components/ClientProviders";
import { useConversations, useHistory, useHistoryLoaded } from "@/features/history/view";
import { useDeviceRelays } from "@/features/relays/view";
import { withCosts } from "@/hooks/useConversationState";

/* ⌘K: one field that goes anywhere. A fixed frame (it never resizes while you
   type), the list on the left with one selection that glides between rows, and
   on the right a drawing of what Enter will do. Chats are found by any word
   you remember; actions, rooms and settings sections by their names or the
   words people use for them, all on one ranking ladder. */

type Room = (typeof ROOMS)[number];
type Sec = NonNullable<(typeof SECTIONS)[number]>;
type ActId = "new" | "model" | "wallet" | "room" | "sync" | "rail" | "settings";
type Found = { idx: number; at: number; len: number; body: string };
type Kind = "chat" | "action" | "room" | "roomjump" | "setting" | "fallback";
interface Item {
  kind: Kind;
  id: string;
  verb: string;
  ic: React.ReactNode;
  label: React.ReactNode;
  sub?: React.ReactNode;
  hint?: React.ReactNode;
  chat?: Conversation;
  found?: Found;
  count?: number;
  room?: Room;
  sec?: Sec;
  act?: ActId;
}
interface Group {
  title: string;
  items: Item[];
  best?: number;
  ghost?: number;
  note?: string;
  fallback?: boolean;
}
type Sync = "idle" | "running" | "done" | "fail" | "nokey" | "norelay" | "slow";
type SyncOutcome = "ok" | "failed" | "offline";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const phoneNow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const F_WD = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { weekday: "short" }) : null;
const F_DAY = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }) : null;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const focusComposer = () =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const f = document.querySelector<HTMLTextAreaElement>(".island textarea");
      if (!f) return;
      f.focus({ preventScroll: true });
      f.setSelectionRange(f.value.length, f.value.length);
    })
  );

/** Short, for the row's end: "now", "19 min", "3 h", "Sep 27". */
const ago = (t: number) => {
  const d = Date.now() - t;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h`;
  return F_DAY ? F_DAY.format(t) : "";
};

const agoLong = (t: number) => {
  const a = ago(t);
  return a === "now" ? "just now" : /min|h$/.test(a) ? `${a} ago` : a;
};

/* ── ranking: one ladder for every kind of result ──────────────────────── */
const tokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
// how one typed word meets a text: 3 the text starts with it, 2 a word in it does, 1 it is inside a word
function fit(text: string, t: string) {
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
function labelScore(label: string, words: string, q: string, toks: string[], titles: string[] = [], phraseSc = 70, hiddenSc = 60) {
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
function titleScore(title: string, q: string, toks: string[]) {
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
const plain = (t: string) =>
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
const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Found words marked with one neutral underlay; the text never changes width. */
function hl(text: string, toks: string[]): React.ReactNode {
  if (!toks.length || !text) return text;
  const re = new RegExp(`(${toks.map(escRe).sort((a, b) => b.length - a.length).join("|")})`, "gi");
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}
/* the window opens at most three words before the hit, so only the tail is
   ever cut (by the row's own ellipsis) and the hit always shows */
function snippet(body: string, at: number, len: number) {
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

const ROOM_WORDS: Record<string, string> = {
  paper: "light day pale light mode",
  night: "dark black dark mode",
  meridian: "hour time dusk",
  overprint: "print ink blue yellow",
  auto: "follow system automatic default hour dark mode light mode",
};
/** The Rooms page: names first, then a word of the line; the room list order breaks ties. */
const roomsFor = (q: string) => {
  const toks = tokens(q);
  const qq = q.trim().toLowerCase();
  if (!toks.length) return ROOMS.slice();
  return ROOMS.map((r, n) => ({ r, n, sc: labelScore(r.name, `${r.line} ${ROOM_WORDS[r.id] ?? ""}`, qq, toks) }))
    .filter((x) => x.sc)
    .sort((a, b) => b.sc - a.sc || a.n - b.n)
    .map((x) => x.r);
};
const sectionsShown = () => SECTIONS.filter((s): s is Sec => !!s && (s.id !== "console" || showConsole()));
const sectionTitles = (id: SettingsSection) => INDEX.filter(([, s]) => s === id).map(([t]) => t);
const sectionWords = (id: SettingsSection) =>
  INDEX.filter(([, s]) => s === id)
    .map(([t, , , w]) => `${t} ${w}`)
    .join(" ");

/* ══ the wrapper: mounted while open or closing ═════════════════════════ */
export default function Palette() {
  const ui = useUi();
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  // each open is a fresh palette, so ⌘K twice fast opens it again cleanly
  const [n, setN] = useState(0);
  useEffect(() => {
    if (ui.palette) {
      setMounted(true);
      setClosing(false);
      setN((x) => x + 1);
    } else if (mounted) {
      setClosing(true);
      const t = window.setTimeout(() => setMounted(false), tokenMs(phoneNow() ? "--d-mid" : "--d-fast"));
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.palette]);
  if (!mounted) return null;
  return <Body closing={closing} key={n} />;
}

/* ══ the palette ═══════════════════════════════════════════════════════ */
function Body({ closing }: { closing: boolean }) {
  const ui = useUi();
  const room = useRoom();
  const money = useMoney();
  const {
    activeConversationId,
    loadConversation,
    startNewConversation,
    setInputMessage,
    models,
    selectedModel,
    isSidebarCollapsed,
    replyCosts,
  } = useChat();
  const history = useHistory();
  const stored = useConversations();
  const conversations = useMemo(() => withCosts(stored, replyCosts), [stored, replyCosts]);
  const conversationsLoaded = useHistoryLoaded();
  const [deviceRelays] = useDeviceRelays();
  const [phone, setPhone] = useState(phoneNow);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 760px)");
    const on = () => setPhone(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const [page, setPage] = useState<"root" | "rooms">("root");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [enter, setEnter] = useState<"fwd" | "back" | null>(null);
  const [keysUsed, setKeysUsed] = useState(false);
  const [sync, setSync] = useState<Sync>("idle");
  const [came, setCame] = useState<string[]>([]);
  const origRoom = useRef<RoomId | null>(null);
  const quiet = useRef(false);

  const pk = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const glide = useRef<HTMLDivElement>(null);
  const instant = useRef(true);
  const instantTwice = useRef(false);
  const scrollNext = useRef(false);
  const returnTo = useRef<Element | null>(null);
  // how the palette closes: which room stays, and where the focus goes
  const exit = useRef<{ keepRoom?: boolean; composer?: boolean; handoff?: boolean }>({});

  const byId = useMemo(() => new Map((models as Model[]).map((m) => [m.id, m])), [models]);
  const glyph = useCallback(
    (id?: string, size: "row" | "inline" = "row") => {
      if (!id) return <Icon name="chat" size={size === "row" ? 16 : 13} />;
      const m = byId.get(id) ?? ({ id, name: id } as Model);
      return renderCompanyIcon(getModelCompanyId(m), "co-ico");
    },
    [byId]
  );
  const perReply = useCallback((m?: Model | null) => (m ? estimateSats(m, promptTokens("", "")) : 0), []);
  const modelWords = useMemo(
    () =>
      (models as Model[])
        .map((m) => `${shortModelName(m.name, m.id)} ${getModelCompanyId(m)}`)
        .join(" ")
        .toLowerCase(),
    [models]
  );
  const lastModel = (c: Conversation) => {
    for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i]._modelId) return c.messages[i]._modelId;
    return undefined;
  };
  const current = (c: Conversation) => c.id === activeConversationId && c.messages.length > 0;
  // the page behind is already a new chat: New chat has nothing to open, it stays
  const onEmpty = !conversations.find((c) => c.id === activeConversationId)?.messages.length;
  // the row an empty root list starts on: over a chat, the previous one
  const homeRow = (l: Item[]) => (!phoneNow() && l[0]?.chat && current(l[0].chat) && l[1]?.kind === "chat" ? 1 : 0);
  const first = conversationsLoaded && conversations.length === 0;

  /* ── the results ─────────────────────────────────────────────────────── */
  const groups = useMemo<Group[]>(() => {
    const toks = tokens(q);
    const chatItem = (c: Conversation, found?: Found, count?: number): Item => {
      const cur = current(c);
      const t = lastActivity(c);
      return {
        kind: "chat",
        id: `chat-${c.id}`,
        chat: c,
        found,
        count,
        verb: cur ? "Stay here" : "Open chat",
        ic: glyph(lastModel(c)),
        label: hl(c.title || "Untitled", toks),
        sub: found ? hl(snippet(found.body, found.at, found.len), toks) : undefined,
        // a phone has room for the words: "5 h ago", as the Continue line says it
        hint: cur ? <span className="now">current</span> : t ? agoLong(t) : undefined,
      };
    };
    const syncHint = () => {
      if (phone) {
        if (sync === "running") return <span className="pk-st">Syncing</span>;
        if (sync === "done") return <span className="pk-st" data-done="">{`Up to date${came.length ? ` · ${came.length} new` : ""}`}</span>;
        if (sync === "fail") return <span className="pk-st" data-fail="">Could not sync</span>;
        if (sync === "nokey") return <span className="pk-st">Sign in to sync</span>;
        if (sync === "norelay") return <span className="pk-st">Add a relay to sync</span>;
        if (sync === "slow") return <span className="pk-st">No answer. Try again</span>;
        return undefined;
      }
      if (sync === "done")
        return (
          <span className="pk-tick">
            <Icon name="check" size={15} />
          </span>
        );
      return undefined;
    };
    const acts: { id: ActId; icon: IconName; label: string; words: string; verb: string; keys?: string[]; push?: boolean }[] = [
      { id: "new", icon: "plus", label: "New chat", words: "new fresh start blank", verb: onEmpty ? "Stay here" : "Start", keys: MAC ? ["⇧", "⌘", "O"] : ["Ctrl", "Shift", "O"] },
      // every model and company the app knows is a word for the model menu
      { id: "model", icon: "think", label: "Choose a model", words: `model switch change llm ai ${modelWords}`, verb: "Open" },
      { id: "wallet", icon: "wallet", label: "Wallet", words: "balance sats money top up add fund pay send receive", verb: "Open" },
      { id: "room", icon: "moon", label: "Change room", words: "room theme look colour color appearance", verb: "Choose", push: true },
      { id: "sync", icon: "sync", label: "Sync chats now", words: "sync relays devices backup refresh", verb: "Sync" },
      ...(phone
        ? []
        : [{ id: "rail" as ActId, icon: "rail" as IconName, label: isSidebarCollapsed ? "Show sidebar" : "Collapse sidebar", words: "sidebar rail panel hide show fold collapse", verb: isSidebarCollapsed ? "Show" : "Collapse", keys: MAC ? ["⌘", "B"] : ["Ctrl", "B"] }]),
      { id: "settings", icon: "gear", label: "Settings", words: "settings preferences options", verb: "Open" },
    ];
    const actItem = (a: (typeof acts)[number]): Item => {
      const busy = a.id === "sync" && sync === "running";
      return {
        kind: "action",
        id: a.id,
        act: a.id,
        verb: busy ? "Syncing" : a.verb,
        // while it runs the sync glyph itself turns: one glyph, no second spinner
        ic: busy ? (
          <span className="pk-spin">
            <Icon name={a.icon} size={16} />
          </span>
        ) : (
          <Icon name={a.icon} size={16} />
        ),
        // an action's name is the match itself: no mark inside the selection
        label: a.label,
        hint:
          a.id === "sync" ? (
            syncHint()
          ) : a.keys && !phone ? (
            // one cap per shortcut
            <kbd>{a.keys.join(MAC ? "" : "+")}</kbd>
          ) : a.push ? (
            <Icon name="right" size={15} />
          ) : undefined,
      };
    };
    const swatch = (id: string) => (
      <span className="pk-sw">
        <span className={`swatch-live sw-${id}`} />
      </span>
    );

    const out: Group[] = [];
    if (page === "rooms") {
      const items = roomsFor(q).map<Item>((r) => ({
        kind: "room",
        id: `room-${r.id}`,
        room: r,
        verb: r.id === origRoom.current ? "Stay here" : "Keep this room",
        ic: swatch(r.id),
        label: r.name,
        hint:
          r.id === origRoom.current ? (
            <span className="pk-tick">
              <Icon name="check" size={15} />
            </span>
          ) : undefined,
      }));
      out.push(items.length ? { title: "", items } : { title: "", note: `No room matches “${q.trim()}”.`, items: [] });
    } else if (!toks.length) {
      if (!conversationsLoaded) out.push({ title: "Recent", ghost: 4, items: [] });
      else if (!conversations.length)
        out.push({ title: "Recent", note: "No chats yet. Once you have some, you can find any of them here by a word you remember.", items: [] });
      else
        out.push({
          title: "Recent",
          items: conversations
            .slice()
            .sort((a, b) => lastActivity(b) - lastActivity(a))
            .slice(0, 5)
            .map((c) => chatItem(c)),
        });
      out.push({ title: "Actions", items: acts.map(actItem) });
    } else {
      const qq = q.trim().toLowerCase();
      const hits: { c: Conversation; score: number; found?: Found; count?: number }[] = [];
      for (const c of conversations) {
        const title = c.title || "Untitled";
        const ts = titleScore(title, qq, toks);
        if (ts) {
          hits.push({ c, score: ts });
          continue;
        }
        if (qq.length < 2) continue; // one letter: titles only
        const t = title.toLowerCase();
        let found: Found | undefined;
        let count = 0;
        c.messages.forEach((m: Message, idx) => {
          if (m.role !== "user" && m.role !== "assistant") return;
          const body = plain(textOf(m.content));
          const lb = body.toLowerCase();
          if (!toks.every((k) => lb.includes(k) || t.includes(k))) return;
          const k0 = toks.find((k) => lb.includes(k)) ?? toks[0];
          const at = lb.indexOf(k0);
          if (at < 0) return;
          count += lb.split(k0).length - 1;
          if (!found) found = { idx, at, len: k0.length, body };
        });
        if (found) hits.push({ c, found, count, score: 20 });
      }
      // the chat you are in goes after the other hits, so Enter takes you somewhere
      const isCur = (h: (typeof hits)[number]) => (current(h.c) ? 1 : 0);
      const best = hits.reduce((m, h) => Math.max(m, h.score), 0);
      hits.sort((a, b) => isCur(a) - isCur(b) || b.score - a.score || lastActivity(b.c) - lastActivity(a.c));
      const more: { sc: number; n: number; it: Item }[] = [];
      acts.forEach((a, n) => {
        // a thing to do right away beats a settings page by a step ("balance" is the Wallet first)
        const sc = labelScore(a.label, a.words, qq, toks, [], 70, 66);
        if (sc) more.push({ sc, n, it: actItem(a) });
      });
      // Follow system too: the way back to the default is one search away
      ROOMS.forEach((r, n) => {
        const sc = labelScore(r.name, `room theme colour color ${ROOM_WORDS[r.id] ?? ""}`, qq, toks, [], 70, 66);
        if (sc)
          more.push({
            sc,
            // a tie goes to the room itself, never to Follow system ("dark" is Night, not "whatever the OS is")
            n: 20 + (r.id === "auto" ? ROOMS.length : n),
            it: {
              kind: "roomjump",
              id: `rj-${r.id}`,
              room: r,
              // the room you are in: Enter keeps it, nothing switches
              verb: room.room === r.id ? "Stay here" : "Switch room",
              ic: swatch(r.id),
              label: (
                <>
                  <span className="pk-crumbtxt">Room</span> <span className="pk-crumbname">{r.name}</span>
                </>
              ),
              hint: room.room === r.id ? <span className="now">current</span> : undefined,
            },
          });
      });
      sectionsShown().forEach((s, n) => {
        // a section ranks a step under an action with the same fit: "model" is
        // most often a model to choose, the Models page comes second
        // the row reads "Settings Look", so "settings look" finds it (one word "settings" is the action's)
        // a page's own id is its alias ("wallet" is Payments), a step over another page's row titles
        const sc = s.id.startsWith(qq) && qq.length > 2 ? 70 : Math.min(75, labelScore(s.name, `${toks.length > 1 ? "settings " : ""}${s.title ?? ""} ${sectionWords(s.id)}`, qq, toks, sectionTitles(s.id), 60));
        if (sc)
          more.push({
            sc,
            n: 40 + n,
            it: {
              kind: "setting",
              id: `set-${s.id}`,
              sec: s,
              verb: "Open",
              ic: <Icon name="gear" size={16} />,
              label: (
                <>
                  <span className="pk-crumbtxt">Settings</span> <span className="pk-crumbname">{s.name}</span>
                </>
              ),
            },
          });
      });
      more.sort((a, b) => b.sc - a.sc || a.n - b.n);
      const chatRows = hits.slice(0, 20).map((h) => ({ it: chatItem(h.c, h.found, h.count), sc: h.score }));
      const actRows = more.map((x) => ({ it: x.it, sc: x.sc }));
      if (!chatRows.length || !actRows.length) {
        if (chatRows.length) out.push({ title: "Chats", items: chatRows.map((r) => r.it) });
        if (actRows.length) out.push({ title: "Actions", items: actRows.map((r) => r.it) });
      } else {
        // the group holding the best match comes first (a tie goes to chats), but only its rows
        // that match at least as well as the other group's best lead; the rest follow the other
        // group, so a hidden word never sits above a title that shows the word
        const chatsLead = best >= more[0].sc;
        const [lead, other] = chatsLead ? [{ t: "Chats", r: chatRows }, { t: "Actions", r: actRows }] : [{ t: "Actions", r: actRows }, { t: "Chats", r: chatRows }];
        const bar = Math.max(...other.r.map((r) => r.sc));
        const keep = lead.r.filter((r) => r.sc >= bar);
        const rest = lead.r.filter((r) => r.sc < bar);
        // the second group ends where the first group's rest begins; what is left of both is one
        // ladder under "More". Never more than three headings, never a weaker row above a stronger
        const restBest = rest.length ? Math.max(...rest.map((r) => r.sc)) : 0;
        const keep2 = other.r.filter((r) => r.sc >= restBest);
        const left = [...rest, ...other.r.filter((r) => r.sc < restBest)].sort((a, b) => b.sc - a.sc);
        out.push({ title: lead.t, items: keep.map((r) => r.it) });
        if (keep2.length) out.push({ title: other.t, items: keep2.map((r) => r.it) });
        if (left.length) out.push({ title: "More", items: left.map((r) => r.it) });
      }
      out.push({
        title: "",
        fallback: !hits.length && !more.length,
        items: [
          {
            kind: "fallback",
            id: "fallback",
            verb: "Start",
            ic: <Icon name="edit" size={16} />,
            label: (
              <>
                New chat with <q>{q.trim()}</q>
              </>
            ),
          },
        ],
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, page, conversations, conversationsLoaded, activeConversationId, glyph, modelWords, isSidebarCollapsed, sync, came, phone, room.room]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const at = Math.min(active, Math.max(0, flat.length - 1));
  const it = flat[at];
  // the selection is an item, not a row number: when the list changes under it (a chat
  // arrives, a sync finishes) it stays on the same item. A new query starts at the top.
  // (at: where it stood, so a move in the same pass as a rebuild is taken as the move it is)
  const sel = useRef<{ id?: string; at: number; q: string; page: string; list: Item[] }>({ at, q, page, list: flat });
  useLayoutEffect(() => {
    const was = sel.current;
    const rebuilt = was.list !== flat;
    if (rebuilt && was.at === at && was.q === q && was.page === page && was.id && flat[at]?.id !== was.id) {
      const i = flat.findIndex((x) => x.id === was.id);
      if (i > -1) {
        // its row moved without animating: the glide lands with it (the first pass already used one)
        instant.current = true;
        instantTwice.current = true;
        setActive(i);
        return;
      }
    }
    sel.current = { id: flat[at]?.id, at, q, page, list: flat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, at]);

  /* ── opening ─────────────────────────────────────────────────────────── */
  useLayoutEffect(() => {
    // (StrictMode runs this twice in development: never record the palette's own field)
    const a = document.activeElement;
    if (!pk.current?.contains(a)) returnTo.current = a;
    // over a chat, the previous chat is the one you most likely want; placed there, not slid
    if (homeRow(flat)) {
      setActive(1);
      // the first placement (row 0, this render) must not use up the instant one
      instantTwice.current = true;
    }
    const el = pk.current;
    const v = veil.current;
    if (!el || !v) return;
    void el.offsetWidth; // commit the closed pose, then open (a reflow, not a frame)
    el.dataset.on = "";
    v.dataset.on = "";
    input.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── closing: put back the room you came from, and the focus ───────────── */
  useEffect(() => {
    if (!closing) return;
    delete pk.current?.dataset.on;
    const how = exit.current;
    if (!how.keepRoom) {
      cancelPreview();
      if (origRoom.current) room.setRoom(origRoom.current);
    }
    if (how.composer) focusComposer();
    // another surface opened in its place and holds the focus now
    else if (how.handoff) return;
    else if (returnTo.current instanceof HTMLElement && returnTo.current.isConnected) returnTo.current.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);
  const close = (how: { keepRoom?: boolean; composer?: boolean; handoff?: boolean } = {}) => {
    exit.current = how;
    ui.setPalette(false);
  };

  /* ── where it sits: over the reading panel, never cutting the rail ─────── */
  const place = useCallback(() => {
    const el = pk.current;
    if (!el) return;
    if (phoneNow()) {
      el.style.removeProperty("--pk-x");
      el.style.removeProperty("--pk-w");
      el.removeAttribute("data-narrow");
      sizeSheet();
      return;
    }
    const panel = document.querySelector<HTMLElement>("[data-furniture='panel']");
    const r = panel ? panelBox(panel) : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const w = Math.round(Math.min(768, Math.max(560, r.width - 32), window.innerWidth - 48));
    el.style.setProperty("--pk-w", `${w}px`);
    el.toggleAttribute("data-narrow", w < 720);
    const cx = Math.max(24 + w / 2, Math.min(window.innerWidth - 24 - w / 2, r.left + r.width / 2));
    el.style.setProperty("--pk-x", `${Math.round(cx)}px`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* phone: as tall as what it holds (at least 60% of the screen), full height
     with the keyboard up. Laid out full height and slid down by what it does
     not need, so a size change is a transform, never a height animation */
  const sizeSheet = () => {
    const el = pk.current;
    const l = list.current;
    if (!el || !l || !phoneNow()) return;
    const vv = window.visualViewport;
    const kb = !!vv && vv.height < window.innerHeight - 120;
    const full = Math.round((kb && vv ? vv.height : window.innerHeight) - 40);
    const ls = getComputedStyle(l);
    const inner = l.firstElementChild as HTMLElement | null;
    const need = el.offsetHeight - l.offsetHeight + (inner?.offsetHeight ?? 0) + parseFloat(ls.paddingTop) + parseFloat(ls.paddingBottom);
    const h = kb ? full : Math.min(full, Math.max(Math.round(window.innerHeight * 0.6), Math.ceil(need)));
    el.style.setProperty("--sheet-h", `${full}px`);
    el.style.setProperty("--sheet-off", `${full - h}px`);
  };
  useLayoutEffect(place, [place, phone]);
  useLayoutEffect(() => {
    if (phone) sizeSheet();
  });
  useEffect(() => {
    const on = () => place();
    window.addEventListener("resize", on);
    window.visualViewport?.addEventListener("resize", on);
    return () => {
      window.removeEventListener("resize", on);
      window.visualViewport?.removeEventListener("resize", on);
    };
  }, [place]);

  /* ── the glide: one selection that moves between rows ────────────────── */
  const placeGlide = useCallback(() => {
    const g = glide.current;
    const row = list.current?.querySelector<HTMLElement>(`.pk-row[data-i="${at}"]`);
    if (!g) return;
    if (!row) {
      g.style.opacity = "0";
      return;
    }
    const now = instant.current;
    instant.current = instantTwice.current;
    instantTwice.current = false;
    g.toggleAttribute("data-instant", now);
    g.style.opacity = "1";
    g.style.transform = `translateY(${row.offsetTop}px)`;
    g.style.height = `${row.offsetHeight}px`;
    if (now) {
      void g.offsetWidth;
      g.removeAttribute("data-instant");
    }
  }, [at]);
  useLayoutEffect(() => {
    placeGlide();
    // a chat title that runs out of room fades at its end; one that fits stays whole
    list.current?.querySelectorAll<HTMLElement>('.pk-row[data-kind="chat"] .pk-l').forEach((l) => l.toggleAttribute("data-cut", l.scrollWidth > l.clientWidth + 1));
    if (scrollNext.current) {
      scrollNext.current = false;
      scrollToActive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeGlide, groups]);
  // late fonts re-wrap notes and snippets: put the glide back on its row
  useEffect(() => {
    if (document.fonts?.status === "loaded") return;
    let live = true;
    document.fonts?.ready.then(() => {
      if (!live) return;
      instant.current = true;
      placeGlide();
    });
    return () => {
      live = false;
    };
  }, [placeGlide]);

  /* keep the selection in view with air, and never leave a group title cut
     by the top edge: it is shown whole or scrolled fully out of sight */
  const scrollToActive = () => {
    const l = list.current;
    const row = l?.querySelector<HTMLElement>(`.pk-row[data-i="${at}"]`);
    if (!l || !row) return;
    const lr = l.getBoundingClientRect();
    const base = l.scrollTop - lr.top;
    const rr = row.getBoundingClientRect();
    const top = rr.top + base;
    const bot = rr.bottom + base;
    const pad = 8;
    const fade = 28;
    const grp = row.closest(".pk-grp");
    const gt = grp?.querySelector<HTMLElement>(".pk-gt");
    const opens = grp?.querySelector(".pk-row") === row;
    let st = l.scrollTop;
    if (opens && gt) {
      const gtTop = gt.getBoundingClientRect().top + base;
      if (gtTop - pad < st) st = gtTop - pad;
    }
    // back in the first group, the list rests at its very top (its heading clear of the fade)
    if (top - pad < st) st = grp === l.querySelector(".pk-grp") ? 0 : top - pad;
    else if (bot + fade > st + l.clientHeight) st = bot + fade - l.clientHeight;
    st = Math.max(0, st);
    l.querySelectorAll<HTMLElement>(".pk-gt").forEach((t) => {
      const r = t.getBoundingClientRect();
      const a = r.top + base;
      const b = r.bottom + base;
      if (st > 0 && a < st + 16 && b > st) st = (t === gt && opens) || b + 4 > top - pad ? a - pad : b + 4;
    });
    l.scrollTop = Math.max(0, Math.round(st));
  };

  /* ── rooms: arrowing through them lights the room behind ─────────────── */
  // a chat that syncs in lands at the top of Recent: bring it into view, so the arrival is seen
  useEffect(() => {
    const l = list.current;
    if (!came.length || page !== "root" || q.trim() || !l || l.scrollTop === 0) return;
    // as far up as it can go while the selected row stays in view (the preview's list shows the
    // arrival when both cannot fit)
    const row = l.querySelector<HTMLElement>('.pk-row[aria-selected="true"]');
    const top = row ? Math.max(0, row.offsetTop + row.offsetHeight + 28 - l.clientHeight) : 0;
    if (top < l.scrollTop) l.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [came.length]);
  const roomTimer = useRef(0);
  const lastRoom = useRef<string | null>(null);
  const roomSeq = useRef(0);
  const cancelPreview = () => {
    window.clearTimeout(roomTimer.current);
    roomSeq.current++;
  };
  useEffect(() => {
    if (page !== "rooms" || !it?.room) return;
    if (it.room.id === "auto" && quiet.current) return;
    const id = it.room.id;
    window.clearTimeout(roomTimer.current);
    const seq = ++roomSeq.current;
    // only after the selection rests: the cross-dissolve is the one heavy moment
    roomTimer.current = window.setTimeout(() => {
      if (seq === roomSeq.current) room.setRoom(id);
    }, 110);
    return () => window.clearTimeout(roomTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, it?.id]);

  /* ── sync: the row turns its glyph, then says what came in ────────────── */
  const syncT = useRef({ start: 0, before: new Set<string>(), timers: [] as number[] });
  // the result stays while you look at it: it clears once the selection leaves Sync
  const onSync = useRef(false);
  onSync.current = it?.id === "sync";
  const idleLater = useRef(false);
  useEffect(() => {
    if (onSync.current || !idleLater.current) return;
    idleLater.current = false;
    setSync("idle");
    setCame([]);
  }, [it?.id]);
  const convRef = useRef(conversations);
  convRef.current = conversations;
  const { manager } = useAccountManager();
  const account = useObservableState(manager.active$);
  const syncCtx = useRef({ active: false, relays: 0 });
  syncCtx.current = { active: !!account, relays: deviceRelays.length };
  const finishSync = useCallback((outcome: SyncOutcome) => {
    const s = syncT.current;
    // the glyph turns for a moment at least, so a quick sync still reads as one
    const wait = Math.max(0, 900 - (performance.now() - s.start));
    s.timers.push(
      window.setTimeout(() => {
        // a skipped sync says why, from what the app knows: no key, no relays, or a signer that did not answer
        const why = !syncCtx.current.active ? "nokey" : !syncCtx.current.relays ? "norelay" : "slow";
        setSync(outcome === "ok" ? "done" : outcome === "offline" ? why : "fail");
        s.timers.push(
          window.setTimeout(() => {
            if (onSync.current) return void (idleLater.current = true);
            setSync("idle");
            setCame([]);
          }, 2600)
        );
      }, wait)
    );
  }, []);
  // chats that came in are counted as they decrypt, not only when the sync ends, and before paint,
  // so a new row, its fade and '+N new' land in the same frame (never plain first, then faded)
  useLayoutEffect(() => {
    if (sync !== "running" && sync !== "done") return;
    const s = syncT.current;
    const ids = conversations.filter((c) => !s.before.has(c.id)).map((c) => c.id);
    setCame((was) => (was.length === ids.length && was.every((id, i) => id === ids[i]) ? was : ids));
  }, [sync, conversations]);
  useEffect(() => () => syncT.current.timers.forEach((t) => window.clearTimeout(t)), []);
  const runSync = async () => {
    if (sync === "running") return;
    const s = syncT.current;
    s.timers.forEach((t) => window.clearTimeout(t));
    s.timers = [];
    s.start = performance.now();
    s.before = new Set(conversations.map((c) => c.id));
    setCame([]);
    setSync("running");
    // the sync says how it ended; a relay that never answers counts as a failure after a while
    const late = new Promise<SyncOutcome>((r) => s.timers.push(window.setTimeout(() => r("failed"), 20_000)));
    const outcome = await Promise.race([history?.sync() ?? Promise.resolve<SyncOutcome>("offline"), late]).catch(() => "failed" as const);
    finishSync(outcome);
  };

  /* ── doing it ────────────────────────────────────────────────────────── */
  const run = (x: Item | undefined) => {
    if (!x) return;
    if (x.kind === "action" && x.act === "room") {
      origRoom.current = room.room;
      setPage("rooms");
      setQ("");
      setEnter("fwd");
      instant.current = true;
      setActive(Math.max(0, ROOMS.findIndex((r) => r.id === room.room)));
      return;
    }
    if (x.kind === "action" && x.act === "sync") return void runSync();
    if (x.kind === "room" && x.room) {
      // Enter keeps the selected room now, even inside the wait before its preview lands
      cancelPreview();
      room.setRoom(x.room.id);
      origRoom.current = null;
      return close({ keepRoom: true });
    }
    if (x.kind === "chat" && x.chat) {
      const cur = current(x.chat);
      close({ keepRoom: true, composer: true });
      ui.setDrawer(false);
      if (!cur) loadConversation(x.chat.id);
      return;
    }
    if (x.kind === "fallback") {
      const words = q.trim();
      close({ keepRoom: true, composer: true });
      ui.setDrawer(false);
      startNewConversation();
      ui.setFace("write");
      setInputMessage(words);
      return;
    }
    if (x.kind === "roomjump" && x.room) {
      close({ keepRoom: true });
      room.setRoom(x.room.id);
      return;
    }
    if (x.kind === "setting" && x.sec) {
      close({ keepRoom: true, handoff: true });
      ui.openSettings(x.sec.id);
      return;
    }
    switch (x.act) {
      case "new":
        close({ keepRoom: true, composer: true });
        ui.setDrawer(false);
        if (!onEmpty) startNewConversation();
        ui.setFace("write");
        return;
      case "model":
        close({ keepRoom: true, handoff: true });
        ui.setPicker(true);
        return;
      case "wallet":
        close({ keepRoom: true, handoff: true });
        window.dispatchEvent(new Event("v2:wallet"));
        return;
      case "rail":
        // the button that opened the palette may be folding away: the reply box takes the focus
        close({ keepRoom: true, composer: true });
        window.dispatchEvent(new Event("v2:fold"));
        return;
      case "settings":
        close({ keepRoom: true, handoff: true });
        ui.openSettings();
        return;
    }
  };

  const back = () => {
    cancelPreview();
    if (origRoom.current) room.setRoom(origRoom.current);
    origRoom.current = null;
    setPage("root");
    setQ("");
    setEnter("back");
    instant.current = true;
    // back onto the row that opened the page
    setActive(-1);
  };
  // after going back, find "Change room" in the rebuilt list
  useLayoutEffect(() => {
    if (active !== -1) return;
    setActive(Math.max(0, flat.findIndex((x) => x.id === "room")));
    scrollNext.current = true;
  }, [active, flat]);
  useLayoutEffect(() => {
    if (active === -2) setActive(homeRow(flat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, flat]);

  const setQuery = (v: string) => {
    if (page !== "rooms") {
      // typing rebuilds the list at once: the selection is placed, not slid over unrelated rows
      instant.current = true;
      setQ(v);
      // cleared, it starts where a fresh open starts (found once the list is rebuilt)
      setActive(v.trim() ? 0 : -2);
      if (list.current) list.current.scrollTop = 0;
      return;
    }
    // rooms: the selection stays on its room while that room is listed; a filter that matched
    // nothing hands it back to the last room you were on (or the one you came from), never room 1
    if (it?.room) lastRoom.current = it.id;
    const keep = lastRoom.current ?? `room-${origRoom.current}`;
    const next = roomsFor(v);
    let i = next.findIndex((r) => `room-${r.id}` === keep);
    if (i < 0) i = Math.max(0, next.findIndex((r) => r.id !== "auto"));
    quiet.current = true;
    setQ(v);
    setActive(i);
    scrollNext.current = true;
    requestAnimationFrame(() => (quiet.current = false));
  };
  const escape = () => {
    if (q.trim()) return setQuery("");
    if (page !== "root") return back();
    close();
  };
  const move = (d: number) => {
    setKeysUsed(true);
    if (!flat.length) return;
    setActive(Math.max(0, Math.min(flat.length - 1, at + d)));
    scrollNext.current = true;
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (e.nativeEvent.isComposing) return;
    // the New chat row's own shortcut does what its Enter does, here too
    if ((MAC ? e.metaKey : e.ctrlKey) && e.shiftKey && k.toLowerCase() === "o") {
      e.preventDefault();
      e.stopPropagation();
      return run({ kind: "action", id: "new", act: "new", verb: "Start", ic: null, label: "New chat" });
    }
    // a row's shortcut does what its Enter does, here too (the sidebar would fold behind the veil)
    if (!phone && (MAC ? e.metaKey : e.ctrlKey) && !e.shiftKey && k.toLowerCase() === "b") {
      e.preventDefault();
      e.stopPropagation();
      return run({ kind: "action", id: "rail", act: "rail", verb: "Collapse", ic: null, label: "Sidebar" });
    }
    // on a Mac, Ctrl+N / Ctrl+P step one row (elsewhere the browser keeps Ctrl+N); ⌘ (Ctrl off a
    // Mac) with an arrow jumps to an end
    if (MAC && e.ctrlKey && !e.shiftKey && (k === "n" || k === "p")) {
      e.preventDefault();
      move(k === "n" ? 1 : -1);
    } else if (k === "ArrowDown") {
      e.preventDefault();
      move((MAC ? e.metaKey : e.ctrlKey) ? 1e3 : 1);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      move((MAC ? e.metaKey : e.ctrlKey) ? -1e3 : -1);
    } else if (k === "PageDown") {
      e.preventDefault();
      move(6);
    } else if (k === "PageUp") {
      e.preventDefault();
      move(-6);
    } else if (k === "Enter") {
      e.preventDefault();
      run(it);
    } else if (k === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      escape();
    } else if (k === "Backspace" && !e.repeat && !e.currentTarget.value && page !== "root") {
      e.preventDefault();
      back();
    } else if (k === "Tab") {
      e.preventDefault();
    }
  };

  /* phone: the sheet follows a finger down from its handle; far or fast enough, it closes */
  const grabDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = pk.current;
    if (!el || e.button > 0) return;
    const y0 = e.clientY;
    let dy = 0;
    let last = { y: y0, t: e.timeStamp };
    let v = 0;
    const move = (m: PointerEvent) => {
      dy = Math.max(0, m.clientY - y0);
      v = (m.clientY - last.y) / Math.max(1, m.timeStamp - last.t);
      last = { y: m.clientY, t: m.timeStamp };
      el.style.transition = "none";
      el.style.transform = `translateY(calc(var(--sheet-off, 0px) + ${dy}px))`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.style.transition = "";
      if (dy > 90 || v > 0.5) {
        el.style.transform = "";
        close();
      } else el.style.transform = "";
      // a drag is not a tap on the handle
      if (dy > 6) window.addEventListener("click", (c) => (c.preventDefault(), c.stopPropagation()), { capture: true, once: true });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /* ghosts: one diagonal light, each piece delayed by where it sits */
  const pageEl = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = pageEl.current;
    if (!root) return;
    const gs = root.querySelectorAll<HTMLElement>(".pf-gw");
    if (!gs.length) return;
    const box = root.getBoundingClientRect();
    gs.forEach((el) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--wd", `${Math.round((r.left - box.left) * 1.1 + (r.top - box.top) * 1.6)}ms`);
    });
  }, [groups]);

  /* ── the footer: where you are, and what the keys will do ────────────── */
  const chatsFound = flat.filter((x) => x.kind === "chat").length;
  // only the sync asked for here: a background one has its own line in the rail
  const syncBusy = sync === "running";
  const footL =
    syncBusy && it?.id !== "sync" ? (
      <>
        <span className="pk-spin">
          <Icon name="sync" size={13} />
        </span>
        Syncing chats
      </>
    ) : !conversationsLoaded ? (
      "Finding your chats"
    ) : page === "rooms" ? (
      `You came from ${ROOMS.find((r) => r.id === origRoom.current)?.name ?? "this room"}`
    ) : q.trim() ? (
      // what the search found, not only its chats (a good action match never reads as a failure)
      chatsFound ? `${plural(chatsFound, "chat")} found` : flat.some((x) => x.kind !== "fallback") ? plural(flat.filter((x) => x.kind !== "fallback").length, "result") : "No chats match"
    ) : conversations.length ? (
      `${plural(conversations.length, "chat")} on this device`
    ) : (
      "No chats on this device yet"
    );
  const escWord = q.trim() ? "Clear" : page !== "root" ? "Back" : "Close";

  const toks = useMemo(() => tokens(q), [q]);
  const shown = useDeferredValue(it);
  let n = -1;

  return (
    <>
      <div className="pk-veil" ref={veil} data-closing={closing ? "" : undefined} onClick={() => close()} />
      <div
        className="pk"
        ref={pk}
        // a click anywhere in the frame never takes the keys from the field (the buttons that need
        // the focus put it back themselves)
        onMouseDown={(e) => e.target !== input.current && e.preventDefault()}
        role="dialog"
        aria-modal="true"
        aria-label="Search and go"
        data-page={page}
        // on touch nothing is lit until the arrow keys are used: a tap is the choice
        data-touch={phone && !keysUsed ? "" : undefined}
        data-closing={closing ? "" : undefined}
      >
        {phone && (
          // the phone sheet's handle: drag it down to put the sheet away, as the model sheet does
          <button type="button" className="pk-grab" aria-label="Close search" tabIndex={-1} onPointerDown={grabDown} onClick={() => close()}>
            <i />
          </button>
        )}
        <div className="pk-field" data-q={q.trim() ? "" : undefined}>
          {page === "rooms" ? (
            <button
              type="button"
              className="pk-crumb"
              aria-label="Back to everything"
              tabIndex={-1}
              onClick={() => {
                back();
                input.current?.focus();
              }}
            >
              <Icon name={phone ? "left" : "back"} size={16} />
              <span>Rooms</span>
            </button>
          ) : (
            <Icon name="search" />
          )}
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="pk-list"
            aria-autocomplete="list"
            aria-activedescendant={it ? `pk-o-${at}` : undefined}
            aria-label={page === "rooms" ? "Filter rooms" : "Search chats and actions"}
            autoComplete="off"
            spellCheck={false}
            placeholder={page === "rooms" ? "Filter rooms" : "Find a chat or an action"}
            value={q}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <button
            type="button"
            className="pk-clear"
            aria-label="Clear search"
            tabIndex={-1}
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <Icon name="close" size={15} />
          </button>
          <button type="button" className="pk-cancel" onClick={() => close()}>
            Cancel
          </button>
        </div>
        <div className="pk-body">
          <div
            className="pk-list scroll"
            id="pk-list"
            role="listbox"
            aria-label="Results"
            ref={list}
            onPointerMove={(e) => {
              const row = (e.target as HTMLElement).closest<HTMLElement>(".pk-row");
              if (!row) return;
              const i = Number(row.dataset.i);
              if (i !== at) setActive(i);
            }}
            // a click never takes the keys from the field: Esc, the arrows and Enter keep working
            onClick={(e) => {
              const row = (e.target as HTMLElement).closest<HTMLElement>(".pk-row");
              if (!row) return;
              const i = Number(row.dataset.i);
              setActive(i);
              // chosen on purpose: a list rebuilt by what it runs (Sync) must not pull it back
              sel.current = { ...sel.current, id: flat[i].id };
              run(flat[i]);
            }}
          >
            <div className="pk-list-in">
              <div className="pk-glide" ref={glide} data-instant="" data-enter={enter ?? undefined} aria-hidden="true" />
              <div className="pk-page" ref={pageEl} data-enter={enter ?? undefined} key={page} onAnimationEnd={() => setEnter(null)}>
                {groups.map((g, gi) => {
                  const gid = g.title ? `pk-g-${gi}` : undefined;
                  const head = g.title ? (
                    <h3 className="pk-gt" id={gid}>
                      {g.title}
                    </h3>
                  ) : null;
                  if (g.ghost)
                    return (
                      <div className="pk-grp pf-ghost" role="status" aria-label="Finding your chats" key={gi}>
                        {head}
                        {Array.from({ length: g.ghost }, (_, r) => (
                          <div className="pk-ghostrow" key={r}>
                            <span className="pf-gw" />
                            <span>
                              {[3.2, 5.6, 2.4, 4.4].slice(0, 2 + (r % 3)).map((w, k) => (
                                <span className="pf-gw" key={k} style={{ width: `${w + ((r * 7 + k * 3) % 5) * 0.4}em` }} />
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  if (g.note)
                    return (
                      <div className="pk-grp" key={gi}>
                        {head}
                        <p className="pk-note">{g.note}</p>
                      </div>
                    );
                  return (
                    <div className="pk-grp" role="group" aria-labelledby={gid} key={gi}>
                      {g.fallback && (
                        <p className="pk-note">
                          Nothing matches <q>{q.trim()}</q> in your chats or actions.
                        </p>
                      )}
                      {head}
                      {g.items.map((x) => {
                        n++;
                        return <Row key={x.id} it={x} i={n} sel={n === at} fresh={!!x.chat && came.includes(x.chat.id)} />;
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {!phone && (
            <div className="pk-pv">
              <Preview
                it={shown}
                toks={toks}
                q={q}
                ctx={{
                  page,
                  sync,
                  came,
                  origRoom: origRoom.current,
                  roomNow: room.room,
                  roomResolved: room.resolved,
                  first,
                  onEmpty,
                  loaded: conversationsLoaded,
                  conversations,
                  current,
                  glyph,
                  perReply,
                  byId,
                  selectedModel: selectedModel as Model | null,
                  total: money.total,
                  railOff: isSidebarCollapsed,
                }}
              />
            </div>
          )}
        </div>
        {!phone && (
          <div className="pk-foot">
            <span className="pk-foot-l">{footL}</span>
            <span className="pk-foot-r">
              {it &&
                (it.id === "sync" && sync === "running" ? (
                  <span className="pk-act is-busy" aria-disabled="true">
                    Syncing
                  </span>
                ) : (
                  <button type="button" className="pk-act primary" tabIndex={-1} onClick={() => (run(it), input.current?.focus())}>
                    {it.verb}
                    <kbd>↵</kbd>
                  </button>
                ))}
              {it && <i />}
              <button type="button" className="pk-act" tabIndex={-1} onClick={() => (escape(), input.current?.focus())}>
                {escWord}
                <kbd>esc</kbd>
              </button>
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/* one row; only the rows whose selection changes render again */
const Row = memo(function Row({ it, i, sel, fresh }: { it: Item; i: number; sel: boolean; fresh: boolean }) {
  return (
    <div className={`pk-row${fresh ? " pk-fresh" : ""}`} role="option" id={`pk-o-${i}`} data-i={i} data-kind={it.kind} aria-selected={sel}>
      <span className="pk-ic">{it.ic}</span>
      <span className="pk-main">
        <span className="pk-l">{it.label}</span>
        {it.sub && <span className="pk-s">{it.sub}</span>}
      </span>
      <span className="pk-h">{it.hint}</span>
    </div>
  );
});

/* ══ the preview: what Enter will do, drawn, not described ═══════════════ */
interface Ctx {
  page: "root" | "rooms";
  sync: Sync;
  came: string[];
  origRoom: RoomId | null;
  roomNow: RoomId;
  roomResolved: RoomId;
  first: boolean;
  onEmpty: boolean;
  loaded: boolean;
  conversations: Conversation[];
  current: (c: Conversation) => boolean;
  glyph: (id?: string) => React.ReactNode;
  perReply: (m?: Model | null) => number;
  byId: Map<string, Model>;
  selectedModel: Model | null;
  total: number;
  railOff: boolean;
}

function Preview({ it, toks, q, ctx }: { it: Item | undefined; toks: string[]; q: string; ctx: Ctx }) {
  if (!it)
    return (
      <div className="pk-pv-in" data-cur="">
        <div className="pk-pv-empty">{ctx.page === "rooms" ? "Clear the filter to see every room." : ctx.loaded ? "Nothing to show yet." : "Your chats are on their way."}</div>
      </div>
    );
  return (
    <div className="pk-pv-in" data-cur="" key={it.id}>
      <Pane it={it} toks={toks} q={q} ctx={ctx} />
    </div>
  );
}

const Line = ({ children }: { children: React.ReactNode }) => <p className="pk-pv-k">{children}</p>;

function Pane({ it, toks, q, ctx }: { it: Item; toks: string[]; q: string; ctx: Ctx }) {
  const m = ctx.selectedModel;
  const mName = m ? shortModelName(m.name, m.id) : "your model";
  const per = ctx.perReply(m);
  if (it.kind === "chat" && it.chat) return <ChatPane it={it} toks={toks} ctx={ctx} />;
  if (it.kind === "room" || it.kind === "roomjump") {
    const r = it.room!;
    const orig = ROOMS.find((x) => x.id === (ctx.origRoom ?? ctx.roomNow));
    const note =
      it.kind === "room"
        ? r.id === ctx.origRoom
          ? "This is your room now."
          : // shown or on its way, the same two lines from the first frame; with a filter typed, Esc
            // clears it first, so the note promises nothing about it
            (<>
              <span className="pk-l1">You are looking at it now.</span>
              <span className="pk-l1">Enter keeps it{orig && !q.trim() ? `, Esc goes back to ${orig.name}` : ""}.</span>
            </>)
        : r.id === ctx.roomNow
          ? "This is your room now."
          : r.id === "auto"
            ? `Enter follows your system: ${window.matchMedia("(prefers-color-scheme: dark)").matches ? "Night" : "Paper"} now.`
            : "Enter switches to this room.";
    return (
      <>
        <h3 className="pk-pv-t">{r.name}</h3>
        <Line>{r.line}.</Line>
        <RoomWindow id={r.id} />
        <p className="pk-pv-note">{note}</p>
      </>
    );
  }
  if (it.kind === "fallback")
    return (
      <>
        <h3 className="pk-pv-t">New chat</h3>
        <Line>Starts a new chat with this text, not sent yet.</Line>
        <MiniPage text={q.trim()} ctx={ctx} />
      </>
    );
  if (it.kind === "setting" && it.sec)
    return (
      <>
        <h3 className="pk-pv-t">{it.sec.name}</h3>
        {/* the words that found it are marked, so a result never looks random */}
        <Line>{hl(it.sec.line, toks)}</Line>
        {/* what the page holds, by the names it uses; a short page says what each one does. A long
            one reads down each column, as the settings overview does */}
        {(() => {
          const rows = INDEX.filter(([, sid]) => sid === it.sec!.id);
          if (rows.length > 3)
            return (
              <div className="pk-pv-list by-col" style={{ gridTemplateRows: `repeat(${Math.ceil(rows.length / 2)}, auto)` }}>
                {rows.map(([t]) => (
                  <span key={t}>{hl(t, toks)}</span>
                ))}
              </div>
            );
          return (
            <div className="pk-pv-rows">
              {rows.map(([t, , , , note]) => (
                <p key={t}>
                  <span>{hl(t, toks)}</span>
                  {note && <span className="pk-pv-rows-s">{hl(note, toks)}</span>}
                </p>
              ))}
            </div>
          );
        })()}
        <p className="pk-pv-note">Enter opens settings at {it.sec.name}.</p>
      </>
    );
  switch (it.act) {
    case "new":
      return (
        <>
          <h3 className="pk-pv-t">New chat</h3>
          <Line>{ctx.onEmpty ? "This chat is already empty." : "Opens an empty chat."}</Line>
          <MiniPage text="" ctx={ctx} />
        </>
      );
    case "model": {
      // a model named in the query comes first
      const named = (id: string) => {
        const x = ctx.byId.get(id)!;
        const n = shortModelName(x.name, x.id).toLowerCase();
        return toks.length > 0 && toks.every((k) => n.includes(k));
      };
      const lately = recentModels(ctx)
        .filter((id) => ctx.byId.has(id))
        .sort((a, b) => Number(named(b)) - Number(named(a)));
      return (
        <>
          <h3 className="pk-pv-t">Choose a model</h3>
          <Line>
            {m ? (
              <>
                <b>
                  {ctx.glyph(m.id)}
                  {hl(mName, toks)}
                </b>{" "}
                answers&nbsp;now{per ? <>, about {sats(per)}&nbsp;sats a reply</> : null}.
              </>
            ) : (
              "No model is chosen yet."
            )}
          </Line>
          {lately.length > 0 && (
            <div className="pk-models">
              <p className="pk-sub-t">
                <span>Lately in your chats</span>
                <span className="mono">per reply</span>
              </p>
              {lately.map((id) => {
                const x = ctx.byId.get(id)!;
                return (
                  <p className="pk-mrow" key={id}>
                    {ctx.glyph(id)}
                    <span>{hl(shortModelName(x.name, x.id), toks)}</span>
                    <span className="mono">~{sats(ctx.perReply(x))} sats</span>
                  </p>
                );
              })}
            </div>
          )}
          <p className="pk-pv-note">Enter opens every model, with prices and details.</p>
        </>
      );
    }
    case "wallet":
      return (
        <>
          <h3 className="pk-pv-t">Wallet</h3>
          <p className="pk-pv-big">
            {sats(ctx.total)}
            <span className="unit">sats</span>
          </p>
          <Line>
            {ctx.total > 0 && per > 0
              ? `About ${plural(Math.floor(ctx.total / per), "reply", "replies")} with ${mName}.`
              : ctx.total > 0
                ? "Ready for your next reply."
                : "Add a few sats to start. Any Lightning wallet works."}
          </Line>
          {ctx.conversations.length > 0 && <Week ctx={ctx} />}
        </>
      );
    case "room": {
      const cur = ROOMS.find((x) => x.id === ctx.roomNow) ?? ROOMS[1];
      const now = ROOMS.find((x) => x.id === ctx.roomResolved);
      return (
        <>
          <h3 className="pk-pv-t">Change room</h3>
          <Line>
            {cur.id === "auto" ? (
              <>
                You follow your system: <b>{now?.name ?? "Paper"}</b> now, {now?.id === "night" ? "Paper when it turns light" : "Night when it turns dark"}.
              </>
            ) : (
              <>
                You are in <b>{cur.name}</b>. {cur.line}.
              </>
            )}
          </Line>
          <RoomWindow id={cur.id} />
          <p className="pk-pv-note">Press Enter, then arrow through the rooms to try each one.</p>
        </>
      );
    }
    case "sync":
      return <SyncPane ctx={ctx} />;
    case "rail":
      return (
        <>
          <h3 className="pk-pv-t">{ctx.railOff ? "Show sidebar" : "Collapse sidebar"}</h3>
          <Line>{ctx.railOff ? "Brings back your chats and wallet on the left." : "Folds your chats to a thin edge and gives the page the room. They stay one keystroke away."}</Line>
          <Schematic to={ctx.railOff ? "on" : "off"} />
        </>
      );
    case "settings":
      return (
        <>
          <h3 className="pk-pv-t">Settings</h3>
          <div className="pk-pv-list by-col">
            {sectionsShown().map((s) => (
              <span key={s.id}>{s.name}</span>
            ))}
          </div>
          <p className="pk-pv-note">Type a section to jump straight there, like “keys” or “usage”.</p>
        </>
      );
  }
  return null;
}

function recentModels(ctx: Ctx) {
  const seen = new Set<string>();
  const list = ctx.conversations.slice().sort((a, b) => lastActivity(b) - lastActivity(a));
  for (const c of list)
    for (let i = c.messages.length - 1; i >= 0; i--) {
      const id = c.messages[i]._modelId;
      if (id) seen.add(id);
    }
  if (ctx.selectedModel) seen.delete(ctx.selectedModel.id);
  return [...seen].slice(0, 4);
}

/* a chat: meta, then the last question and its answer (or the found message
   and its neighbour), trimmed to its last whole line */
function ChatPane({ it, toks, ctx }: { it: Item; toks: string[]; ctx: Ctx }) {
  const c = it.chat!;
  const body = useRef<HTMLDivElement>(null);
  const spent = c.messages.reduce((s, m) => s + (m.satsSpent || 0), 0);
  let lastId: string | undefined;
  for (let i = c.messages.length - 1; i >= 0 && !lastId; i--) lastId = c.messages[i]._modelId;
  const nameOf = (id?: string) => {
    const x = id ? ctx.byId.get(id) : undefined;
    // a model the list does not know (yet) reads by its own name, not its provider path
    return shortModelName(x?.name, id?.split("/").pop()) || "assistant";
  };
  const t = lastActivity(c);
  const when = t ? agoLong(t) : "";
  const meta = [
    plural(c.messages.filter((m) => m.role === "user" || m.role === "assistant").length, "message"),
    lastId ? nameOf(lastId) : "",
    spent ? `${sats(spent)} sats` : "",
    when,
  ].filter(Boolean);
  const say = (m: Message, k: string) => (
    <div className={`pk-say ${m.role === "user" ? "me" : "ai"}`} key={k}>
      <p className="pk-who">{m.role === "user" ? "you" : nameOf(m._modelId).toLowerCase()}</p>
      <p className="pk-said">{hl(plain(textOf(m.content)), toks)}</p>
    </div>
  );
  const talk = c.messages.filter((m) => m.role === "user" || m.role === "assistant");
  let conv: React.ReactNode[] = [];
  if (it.found) {
    const m = c.messages[it.found.idx];
    const i = talk.indexOf(m);
    const prev = i > 0 ? talk[i - 1] : undefined;
    const next = talk[i + 1];
    conv = m.role === "user" ? [say(m, "a"), next && say(next, "b")] : [prev && say(prev, "a"), say(m, "b")];
  } else {
    let qi = -1;
    for (let i = talk.length - 1; i >= 0; i--)
      if (talk[i].role === "user") {
        qi = i;
        break;
      }
    if (qi > -1) conv = [say(talk[qi], "a"), talk[qi + 1] && say(talk[qi + 1], "b")];
  }
  const note = it.found && (it.count ?? 0) > 1 ? `Found ${it.count} times in this chat.` : ctx.current(c) ? "You are in this chat now." : "";
  // a cut conversation ends on a whole line, and that line fades
  useLayoutEffect(() => {
    const pb = body.current;
    if (!pb) return;
    const fitLines = () => {
      pb.style.height = "";
      pb.removeAttribute("data-over");
      if (pb.scrollHeight <= pb.clientHeight + 1) return;
      const top = pb.getBoundingClientRect().top;
      const room = pb.clientHeight;
      let fit = 0;
      const walk = document.createTreeWalker(pb, NodeFilter.SHOW_TEXT);
      const rg = document.createRange();
      for (let nd = walk.nextNode(); nd; nd = walk.nextNode()) {
        rg.selectNodeContents(nd);
        for (const r of Array.from(rg.getClientRects())) {
          const b = r.bottom - top;
          if (b <= room + 0.5) fit = Math.max(fit, b);
        }
      }
      if (!fit) return;
      pb.style.height = `${Math.min(room, Math.ceil(fit))}px`;
      pb.setAttribute("data-over", "");
    };
    fitLines();
    let live = true;
    if (document.fonts?.status !== "loaded") document.fonts?.ready.then(() => live && fitLines());
    return () => {
      live = false;
    };
    // measured again whenever what it shows changes (a new query can keep the same chat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.found?.idx, toks.join(" ")]);
  return (
    <>
      <h3 className="pk-pv-t">{hl(c.title || "Untitled", toks)}</h3>
      <p className="pk-pv-m">
        {meta.map((x) => (
          <span key={x}>{x}</span>
        ))}
      </p>
      {conv.some(Boolean) && (
        <div className="pk-pv-body" ref={body}>
          {conv}
        </div>
      )}
      {note && <p className="pk-pv-note">{note}</p>}
    </>
  );
}

/* the new page, drawn small: its greeting, the composer, the model, the price */
function MiniPage({ text, ctx }: { text: string; ctx: Ctx }) {
  const m = ctx.selectedModel;
  const per = ctx.perReply(m);
  return (
    <div className="pk-minipage" aria-hidden="true">
      {/* the page Enter lands on: the one on screen when it already is a new chat */}
      <p className="pk-mini-g">{ctx.onEmpty ? shownLine() : peekLine(ctx.first)}</p>
      <div className="pk-mini">
        <p className={`pk-mini-f${text ? " has" : ""}`}>
          {text ? (
            <>
              {text}
              <i className="pk-caret" />
            </>
          ) : (
            "Ask anything"
          )}
        </p>
        <p className="pk-mini-u">
          <span className="pk-mini-m">
            {m ? ctx.glyph(m.id) : null}
            {m ? shortModelName(m.name, m.id) : "No model yet"}
          </span>
          {per > 0 && <span className="pk-mini-p">~{sats(per)} sats</span>}
          <span className="pk-mini-go" data-idle={text ? undefined : ""}>
            <Icon name="send" size={12} />
          </span>
        </p>
      </div>
    </div>
  );
}

/* one window onto the room: its swatch, large, with the furniture standing in it */
const RoomLayer = ({ id }: { id: string }) => (
  <span className="pk-win-l" data-r={id}>
    <span className={`swatch-live sw-${id}`} />
    <span className="pk-win-r" />
    <span className="pk-win-p" />
  </span>
);
// Follow system is Paper and Night at once: one room over the other, cut on a single line
const RoomWindow = ({ id }: { id: string }) => (
  <div className="pk-win" data-auto={id === "auto" ? "" : undefined} aria-hidden="true">
    {id === "auto" ? (
      <>
        <RoomLayer id="paper" />
        <RoomLayer id="night" />
      </>
    ) : (
      <RoomLayer id={id} />
    )}
  </div>
);

/* seven days of spending, one bar per day, today in the room's colour */
function Week({ ctx }: { ctx: Ctx }) {
  const day0 = new Date();
  day0.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => ({ t: day0.getTime() - (6 - i) * 86_400_000, s: 0, n: 0 }));
  for (const c of ctx.conversations)
    for (const m of c.messages) {
      const at = toMs(m._createdAt);
      if (!m.satsSpent || !at) continue;
      const d = days.find((x) => at >= x.t && at < x.t + 86_400_000);
      if (d) {
        d.s += m.satsSpent;
        d.n++;
      }
    }
  const max = Math.max(1, ...days.map((d) => d.s));
  const total = days.reduce((a, d) => a + d.s, 0);
  const replies = days.reduce((a, d) => a + d.n, 0);
  return (
    <div className="pk-week">
      <p className="pk-sub-t">
        <span>Last 7 days</span>
        <span className="mono">
          {sats(total)} sats · {plural(replies, "reply", "replies")}
        </span>
      </p>
      <div className="pk-bars" aria-hidden="true">
        {days.map((d, i) => (
          <span className={`pk-bar${i === 6 ? " today" : ""}`} key={d.t}>
            <i style={{ "--h": d.s ? Math.max(0.06, d.s / max).toFixed(3) : 0, "--n": i + 1 } as React.CSSProperties} />
            <b>{F_WD ? F_WD.format(d.t) : ""}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function SyncPane({ ctx }: { ctx: Ctx }) {
  const fresh = ctx.conversations.filter((c) => ctx.came.includes(c.id)).slice(0, 4);
  return (
    <>
      <h3 className="pk-pv-t">Sync chats now</h3>
      <Line>Brings in chats from your other devices and saves new ones for them. They are encrypted with your key before they leave.</Line>
      <p className="pk-pv-big pk-pv-count">
        {ctx.conversations.length.toLocaleString("en-US")}
        <span className="unit">{ctx.conversations.length === 1 ? "chat on this device" : "chats on this device"}</span>
        {ctx.came.length > 0 && <span className="pk-new">+{ctx.came.length} new</span>}
      </p>
      {ctx.sync === "running" ? (
        <p role="status" className="pk-sline" data-s="run">
          <span>Syncing chats</span>
          <span className="pf-sync-bar">
            <i />
          </span>
        </p>
      ) : ctx.sync === "done" ? (
        <p role="status" className="pk-sline" data-s="done">
          <Icon name="check" size={14} />
          <span>Up to date</span>
        </p>
      ) : ctx.sync === "nokey" ? (
        <p role="status" className="pk-sline">
          <span>Nothing to sync with yet. Sign in to sync your chats.</span>
        </p>
      ) : ctx.sync === "norelay" ? (
        <p role="status" className="pk-sline">
          <span>There are no relays to sync with. Add one in Sync and storage.</span>
        </p>
      ) : ctx.sync === "slow" ? (
        <p role="status" className="pk-sline" data-s="fail">
          <span>Your signer did not answer. Try again.</span>
        </p>
      ) : ctx.sync === "fail" ? (
        <p role="status" className="pk-sline" data-s="fail">
          <span>Could not sync. Try again.</span>
        </p>
      ) : null}
      {ctx.sync === "done" && fresh.length > 0 && (
        <div className="pk-models pk-came">
          <p className="pk-sub-t">
            <span>New from your other devices</span>
          </p>
          {fresh.map((c) => {
            let id: string | undefined;
            for (let i = c.messages.length - 1; i >= 0 && !id; i--) id = c.messages[i]._modelId;
            const t = lastActivity(c);
            const when = t ? agoLong(t) : "";
            return (
              <p className="pk-mrow" key={c.id}>
                {ctx.glyph(id)}
                <span>{c.title || "Untitled"}</span>
                {when && <span className="mono">last message {when}</span>}
              </p>
            );
          })}
        </div>
      )}
    </>
  );
}

/* the room with and without the sidebar; it plays once when you land on the row */
function Schematic({ to }: { to: "on" | "off" }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = el.current;
    const p = s?.querySelector<HTMLElement>(".pk-schem-p");
    if (!s || !p) return;
    s.style.setProperty("--pw", String(p.offsetWidth));
    if (reduced()) return void s.setAttribute("data-play", "");
    const t = window.setTimeout(() => s.setAttribute("data-play", ""), 260);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="pk-schem" data-to={to} ref={el} aria-hidden="true">
      <span className="pk-schem-r">
        <i />
        <i />
        <i />
      </span>
      <span className="pk-schem-p">
        <i />
        <i />
        <i />
        <b />
      </span>
    </div>
  );
}
