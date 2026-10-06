import React, { useEffect } from "react";
import type { useRoom } from "../room/RoomProvider";
import type { Item } from "./types";

/* ── rooms: arrowing through them lights the room behind ─────────────── */
export function useRoomPreview({
  page,
  it,
  quiet,
  room,
  roomTimer: roomTimerRef,
  roomSeq: roomSeqRef,
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
    window.clearTimeout(roomTimerRef.current);
    const seq = ++roomSeqRef.current;
    // only after the selection rests: the cross-dissolve is the one heavy moment
    roomTimerRef.current = window.setTimeout(() => {
      if (seq === roomSeqRef.current) room.setRoom(id);
    }, 110);
    return () => window.clearTimeout(roomTimerRef.current);
  }, [page, it?.id]);
}
