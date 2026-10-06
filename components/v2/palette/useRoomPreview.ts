import React, { useEffect } from "react";
import type { useRoom } from "../room/RoomProvider";
import type { Item } from "./types";

/* ── rooms: arrowing through them lights the room behind ─────────────── */
export function useRoomPreview({
  page,
  it,
  quiet,
  room,
  roomTimer,
  roomSeq,
}: {
  page: "root" | "rooms";
  it: Item | undefined;
  quiet: React.RefObject<boolean>;
  room: ReturnType<typeof useRoom>;
  roomTimer: React.RefObject<number>;
  roomSeq: React.RefObject<number>;
}) {
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
}
