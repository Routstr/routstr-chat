import React, { useMemo } from "react";
import type { Conversation, Message } from "@/types/chat";
import { Icon } from "../icons";
import { ROOMS, type RoomId, type useRoom } from "../room/RoomProvider";
import { lastActivity, textOf } from "../format";
import { ROOM_WORDS, labelScore, plain, roomsFor, titleScore, tokens } from "./rank";
import { sectionTitles, sectionWords, sectionsShown } from "./sections";
import { actItem, actions, chatItem, swatch } from "./items";
import type { Found, Group, Item, Sync } from "./types";

/* ── the results ─────────────────────────────────────────────────────── */
export function useGroups({
  q,
  page,
  conversations,
  conversationsLoaded,
  activeConversationId,
  glyph,
  modelWords,
  isSidebarCollapsed,
  sync,
  came,
  phone,
  room,
  origRoom,
  current,
  onEmpty,
}: {
  q: string;
  page: "root" | "rooms";
  conversations: Conversation[];
  conversationsLoaded: boolean;
  activeConversationId: string | null;
  glyph: (id?: string) => React.ReactNode;
  modelWords: string;
  isSidebarCollapsed: boolean;
  sync: Sync;
  came: string[];
  phone: boolean;
  room: ReturnType<typeof useRoom>;
  origRoom: React.RefObject<RoomId | null>;
  current: (c: Conversation) => boolean;
  onEmpty: boolean;
}) {
  return useMemo<Group[]>(() => {
    const toks = tokens(q);
    const acts = actions(onEmpty, modelWords, phone, isSidebarCollapsed);

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
            .map((c) => chatItem(c, toks, current, glyph)),
        });
      out.push({ title: "Actions", items: acts.map((a) => actItem(a, sync, came, phone)) });
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
        if (sc) more.push({ sc, n, it: actItem(a, sync, came, phone) });
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
      const chatRows = hits.slice(0, 20).map((h) => ({ it: chatItem(h.c, toks, current, glyph, h.found, h.count), sc: h.score }));
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
}
