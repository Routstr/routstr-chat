import type { MessageContent } from "@/types/chat";
import { ROOT_ID, type Stored } from "./codec";

/** A message on screen: `_prevId` is the parent it hangs off. */
export type StoredMessage = Stored & { _prevId: string };

/** One place in a thread: its versions (retries or edits) and the one shown. */
export interface ThreadSlot {
  keys: string[];
  displayed: StoredMessage;
  displayedIndex: number;
}

/** By time; within one second a parent before its reply, a question before an answer. */
export function byTime(messages: Stored[]): Stored[] {
  return [...messages].sort((a, b) => {
    if (a._createdAt !== b._createdAt) return a._createdAt - b._createdAt;
    if (b._prevId === a._eventId) return -1;
    if (a._prevId === b._eventId) return 1;
    if (a.role === "user" && b.role !== "user") return -1;
    if (b.role === "user" && a.role !== "user") return 1;
    return 0;
  });
}

/**
 * The thread as shown: siblings at one depth are versions of each other, and
 * only the shown version's replies form the next depth. `selected` maps a
 * depth to the version picked there; otherwise the newest shows.
 *
 * System notes (errors and "Generation stopped." that main saved) are left
 * out, and what hung off one hangs off its parent instead.
 */
export function buildThread(
  messages: Stored[],
  selected: ReadonlyMap<number, string>
): ThreadSlot[] {
  const noteParent = new Map<string, string | undefined>();
  for (const m of messages) {
    if (m.role === "system") noteParent.set(m._eventId, m._prevId);
  }
  const sorted = byTime(messages.filter((m) => m.role !== "system"));

  const children = new Map<string, Stored[]>();
  const roots: Stored[] = [];
  const parentOf: (string | null)[] = [];
  sorted.forEach((m, i) => {
    let parent = m._prevId;
    while (parent !== undefined && noteParent.has(parent)) {
      parent = noteParent.get(parent);
    }
    let resolved: string | null;
    if (parent === ROOT_ID && m.role === "user") {
      resolved = null;
    } else if (parent !== undefined && parent !== ROOT_ID) {
      resolved = parent;
    } else {
      // No parent written (main's migrated chats), or an answer saved as a
      // root after its question failed to save: the order says where it goes.
      const prev = sorted[i - 1];
      resolved = !prev
        ? null
        : prev.role === m.role
          ? parentOf[i - 1]
          : prev._eventId;
    }
    parentOf[i] = resolved;
    if (resolved === null) roots.push(m);
    else children.set(resolved, [...(children.get(resolved) ?? []), m]);
  });

  const slots: ThreadSlot[] = [];
  let siblings = roots;
  let parent = ROOT_ID;
  while (siblings.length > 0) {
    const keys = siblings.map((m) => m._eventId);
    const pick = keys.indexOf(selected.get(slots.length) ?? "");
    const displayedIndex = pick === -1 ? siblings.length - 1 : pick;
    const displayed = { ...siblings[displayedIndex], _prevId: parent };
    slots.push({ keys, displayed, displayedIndex });
    parent = displayed._eventId;
    siblings = children.get(parent) ?? [];
  }
  return slots;
}

/** The visible text of a message: its first part that is not hidden. */
function textOf(content: string | MessageContent[]): string {
  if (typeof content === "string") return content;
  return (
    content.find((part) => part.type === "text" && !part.hidden)?.text ?? ""
  );
}

/** main's rule: the first message, trimmed to 50 characters. */
export function titleOf(first: Stored | undefined): string {
  const text = first ? textOf(first.content).trim() : "";
  if (!text) return "New Conversation";
  return text.length > 50 ? `${text.substring(0, 50)}...` : text;
}
