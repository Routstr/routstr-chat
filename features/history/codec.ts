import type { NostrEvent } from "nostr-tools";
import type { Message } from "@/types/chat";
import { createPnsEvent, decryptPnsEvent, type PnsKeys } from "@/lib/pns";

const KIND_CHAT = 20001;

/** The parent every first question points at. */
export const ROOT_ID = "0".repeat(64);

/** A message as history keeps it: the id of its kind 1080 and the second it
 *  was written. `_prevId` is missing on messages main migrated from before
 *  sync, which only have their order. */
export type Stored = Message & { _eventId: string; _createdAt: number };

export interface Entry {
  conversationId: string;
  message: Stored;
}

/** One message, encrypted the way main writes it, so every client reads it. */
export function encodeMessage(
  conversationId: string,
  message: Message,
  author: string,
  createdAt: number,
  keys: PnsKeys
): NostrEvent {
  const tags = [
    ["d", conversationId],
    ["role", message.role],
    ["client", "routstr-chat"],
  ];
  if (message._prevId) tags.push(["e", message._prevId]);
  if (message.role === "assistant") {
    tags.push(["model", message._modelId || "unknown-model"]);
  }
  return createPnsEvent(
    {
      kind: KIND_CHAT,
      pubkey: author,
      created_at: createdAt,
      tags,
      content:
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
    },
    keys
  );
}

/** A kind 1080 back into a message, or null when these keys did not write it. */
export function decodeMessage(event: NostrEvent, keys: PnsKeys): Entry | null {
  const inner = decryptPnsEvent(event, keys);
  if (
    inner?.kind !== KIND_CHAT ||
    !Array.isArray(inner.tags) ||
    typeof inner.content !== "string"
  ) {
    return null;
  }
  const tag = (name: string): string | undefined =>
    inner.tags.find((t: unknown) => Array.isArray(t) && t[0] === name)?.[1];
  const conversationId = tag("d");
  if (!conversationId) return null;
  return {
    conversationId,
    message: {
      role: tag("role") || "user",
      content: parseContent(inner.content),
      _eventId: event.id,
      _prevId: tag("e"),
      _createdAt: inner.created_at,
      _modelId: tag("model"),
    },
  };
}

// Only an array of content parts is stored as JSON. Anything else that
// happens to parse ('{"a":1}', "null") is what the person typed.
function parseContent(raw: string): Message["content"] {
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((part) => typeof part?.type === "string")
    ) {
      return parsed;
    }
  } catch {
    // plain text
  }
  return raw;
}
