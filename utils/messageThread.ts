import { Message } from "@/types/chat";

export interface ThreadSlot {
  keys: string[];
  displayed: Message;
  displayedIndex: number;
}

export interface ThreadSlots {
  slots: ThreadSlot[];
  allKeys: Set<string>;
}

/**
 * Build the displayed thread by walking the message tree along the selected
 * path: siblings at a depth are versions (retry/edit), only the displayed
 * sibling's children form the next depth, so switching a version swaps the
 * whole branch below it. `selectedVersions` maps depth -> version key,
 * where a key is the message's _eventId or `local-<index>` for messages
 * stored before sync keys derive.
 */
export function buildThreadSlots(
  messages: Message[],
  systemGroupsMap: Map<number, { firstMessage: Message; count: number }>,
  selectedVersions: Map<number, string>
): ThreadSlots {
  // Collapse each system group to its first message
  const messagesToVersion: Message[] = [];
  let skipUntilIndex = -1;
  messages.forEach((msg, index) => {
    if (index <= skipUntilIndex) return;

    const systemGroup = systemGroupsMap.get(index);
    if (systemGroup) {
      messagesToVersion.push(systemGroup.firstMessage);
      skipUntilIndex = index + systemGroup.count - 1;
    } else {
      messagesToVersion.push(msg);
    }
  });

  // Id-less messages (stored before keys derive) would all become roots and
  // roots render as versions of each other; fall back to array order, where
  // a same-role neighbor is a sibling version and a different-role neighbor
  // is the next turn.
  const ZERO_ID = "0".repeat(64);
  const keyOf = (m: Message, i: number) => m._eventId || `local-${i}`;
  const msgKey = new Map<Message, string>();
  const childrenMap = new Map<string, Message[]>();
  const roots: Message[] = [];
  const effectivePrev: (string | null)[] = [];

  messagesToVersion.forEach((msg, i) => {
    msgKey.set(msg, keyOf(msg, i));
    let prevId = !msg._prevId || msg._prevId === ZERO_ID ? null : msg._prevId;
    if (prevId === null && i > 0) {
      const prev = messagesToVersion[i - 1];
      prevId =
        prev.role === msg.role
          ? effectivePrev[i - 1] // sibling: version of the same parent
          : keyOf(prev, i - 1); // next turn: child of the previous message
    }
    effectivePrev[i] = prevId;
    if (!prevId) {
      roots.push(msg);
    } else {
      if (!childrenMap.has(prevId)) {
        childrenMap.set(prevId, []);
      }
      childrenMap.get(prevId)!.push(msg);
    }
  });

  // For a collapsed system group, resolve the group-start event id to the
  // id of the group's last message (children reference that one)
  const getEventIdForLastMessage = (eventId: string): string | undefined => {
    if (!eventId) return eventId;

    for (const [startIndex, group] of systemGroupsMap) {
      if (group.firstMessage._eventId === eventId) {
        const lastMessageIndex = startIndex + group.count - 1;
        if (lastMessageIndex < messages.length) {
          return messages[lastMessageIndex]._eventId;
        }
      }
    }

    return eventId;
  };

  const slots: ThreadSlot[] = [];

  let siblings = roots;
  let depth = 0;
  while (siblings.length > 0) {
    siblings.sort((a, b) => (a._createdAt || 0) - (b._createdAt || 0));
    const keys = siblings.map((m) => msgKey.get(m)!);

    const selectedKey = selectedVersions.get(depth);
    let displayedIndex = selectedKey ? keys.indexOf(selectedKey) : -1;
    if (displayedIndex === -1) displayedIndex = siblings.length - 1;
    const displayed = siblings[displayedIndex];

    slots.push({ keys, displayed, displayedIndex });

    // Children hang off the displayed sibling only
    let parentKey: string | undefined = keys[displayedIndex];
    if (displayed.role === "system" && displayed._eventId) {
      const remapped = getEventIdForLastMessage(displayed._eventId);
      if (remapped) parentKey = remapped;
    }
    siblings = (parentKey && childrenMap.get(parentKey)) || [];
    depth++;
  }

  return { slots, allKeys: new Set(msgKey.values()) };
}
