"use client";

import { INDEX } from "../settings/Settings";
import { ROOMS } from "../room/RoomProvider";
import { lastActivity, sats, shortModelName } from "../format";
import { hl, Line, plural } from "./helpers";
import { sectionsShown } from "./sections";
import ChatPane from "./ChatPane";
import SyncPane from "./SyncPane";
import { MiniPage, RoomWindow, Schematic, Week } from "./drawings";
import type { Ctx, Item } from "./types";

/* ══ the preview: what Enter will do, drawn, not described ═══════════════ */
export default function Preview({ it, toks, q, ctx }: { it: Item | undefined; toks: string[]; q: string; ctx: Ctx }) {
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

function Pane({ it, toks, q, ctx }: { it: Item; toks: string[]; q: string; ctx: Ctx }) {
  const m = ctx.selectedModel;
  const mName = m ? shortModelName(m.name, m.id) : "your model";
  const per = ctx.perReply(m);
  if (it.kind === "chat" && it.chat) return <ChatPane it={it} toks={toks} ctx={ctx} />;
  if (it.kind === "room" || it.kind === "roomjump") {
    const r = it.room!;
    const orig = ROOMS.find((x) => x.id === (ctx.origRoom.current ?? ctx.roomNow));
    const note =
      it.kind === "room"
        ? r.id === ctx.origRoom.current
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
