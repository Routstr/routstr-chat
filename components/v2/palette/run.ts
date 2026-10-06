import type React from "react";
import type { useChat } from "@/context/ChatProvider";
import type { Conversation } from "@/types/chat";
import type { useUi } from "../ui";
import { ROOMS, type RoomId, type useRoom } from "../room/RoomProvider";
import type { Exit, Item } from "./types";

/* ── doing it ────────────────────────────────────────────────────────── */
export function runItem(
  x: Item | undefined,
  {
    q,
    onEmpty,
    current,
    ui,
    room,
    origRoom,
    instant,
    setPage,
    setQ,
    setEnter,
    setActive,
    runSync,
    cancelPreview,
    close,
    loadConversation,
    startNewConversation,
    setInputMessage,
  }: {
    q: string;
    onEmpty: boolean;
    current: (c: Conversation) => boolean;
    ui: ReturnType<typeof useUi>;
    room: ReturnType<typeof useRoom>;
    origRoom: React.RefObject<RoomId | null>;
    instant: React.RefObject<boolean>;
    setPage: (p: "root" | "rooms") => void;
    setQ: (q: string) => void;
    setEnter: (e: "fwd" | "back" | null) => void;
    setActive: (i: number) => void;
    runSync: () => Promise<void>;
    cancelPreview: () => void;
    close: (how?: Exit) => void;
  } & Pick<ReturnType<typeof useChat>, "loadConversation" | "startNewConversation"> & { setInputMessage: (text: string) => void }
) {
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
}
