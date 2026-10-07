import type { ThreadSlot } from "@/features/history/view";

/** Where a message sits in a thread: shown at a depth, or another version at
 *  a depth (show it first), or not on this thread at all. */
export function hitIn(slots: ThreadSlot[], message: string): { shown: number } | { other: number } | null {
  const shown = slots.findIndex((s) => s.displayed._eventId === message);
  if (shown >= 0) return { shown };
  const other = slots.findIndex((s) => s.keys.includes(message));
  return other >= 0 ? { other } : null;
}
