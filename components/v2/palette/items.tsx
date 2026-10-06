import React from "react";
import type { Conversation } from "@/types/chat";
import { Icon, type IconName } from "../icons";
import { lastActivity } from "../format";
import { agoLong, hl, MAC } from "./helpers";
import { snippet } from "./rank";
import type { ActId, Found, Item, Sync } from "./types";

export type Act = { id: ActId; icon: IconName; label: string; words: string; verb: string; keys?: string[]; push?: boolean };

const lastModel = (c: Conversation) => {
  for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i]._modelId) return c.messages[i]._modelId;
  return undefined;
};

export const chatItem = (
  c: Conversation,
  toks: string[],
  current: (c: Conversation) => boolean,
  glyph: (id?: string) => React.ReactNode,
  found?: Found,
  count?: number
): Item => {
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

const syncHint = (phone: boolean, sync: Sync, came: string[]) => {
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

export const actions = (onEmpty: boolean, modelWords: string, phone: boolean, isSidebarCollapsed: boolean): Act[] => [
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

export const actItem = (a: Act, sync: Sync, came: string[], phone: boolean): Item => {
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
        syncHint(phone, sync, came)
      ) : a.keys && !phone ? (
        // one cap per shortcut
        <kbd>{a.keys.join(MAC ? "" : "+")}</kbd>
      ) : a.push ? (
        <Icon name="right" size={15} />
      ) : undefined,
  };
};

export const swatch = (id: string) => (
  <span className="pk-sw">
    <span className={`swatch-live sw-${id}`} />
  </span>
);
