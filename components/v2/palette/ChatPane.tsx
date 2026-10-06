"use client";

import React, { useLayoutEffect, useRef } from "react";
import type { Message } from "@/types/chat";
import { lastActivity, sats, shortModelName, textOf } from "../format";
import { agoLong, hl, plural } from "./helpers";
import { plain } from "./rank";
import type { Ctx, Item } from "./types";

/* a chat: meta, then the last question and its answer (or the found message
   and its neighbour), trimmed to its last whole line */
export default function ChatPane({ it, toks, ctx }: { it: Item; toks: string[]; ctx: Ctx }) {
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
