"use client";

import { Icon } from "../icons";
import { lastActivity } from "../format";
import { agoLong, Line } from "./helpers";
import type { Ctx } from "./types";

export default function SyncPane({ ctx }: { ctx: Ctx }) {
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
      ) : ctx.sync === "unreached" ? (
        <p role="status" className="pk-sline" data-s="fail">
          <span>No relay answered. Check your connection and try again.</span>
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
