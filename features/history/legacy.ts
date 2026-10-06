import type { Message } from "@/types/chat";

const SAVED_KEY = "saved_conversations";
const SAVED_AT_KEY = "saved_conversations_updated_at";

type KeyValueStorage = Pick<Storage, "getItem" | "removeItem">;

export interface SavedMessage {
  conversationId: string;
  message: Message;
  createdAt: number;
}

/**
 * Chats main kept in plain text before sync, still waiting to be encrypted.
 * Messages that already have an event id are copies of synced history. Each
 * gets its own second, from the chat's start, so the order survives.
 */
export function readSavedConversations(
  storage: KeyValueStorage,
  nowSeconds: number
): SavedMessage[] | null {
  const raw = storage.getItem(SAVED_KEY);
  if (raw === null) return null;
  let conversations: unknown;
  try {
    conversations = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(conversations)) return [];
  return conversations.flatMap((conversation) => {
    if (
      typeof conversation?.id !== "string" ||
      !Array.isArray(conversation.messages)
    ) {
      return [];
    }
    const started = Math.floor(Number(conversation.id) / 1000);
    const base = Number.isFinite(started) && started > 0 ? started : nowSeconds;
    return (conversation.messages as Message[])
      .filter(
        (message) => message && !message._eventId && message.role !== "system"
      )
      .map((message, i) => ({
        conversationId: conversation.id,
        message,
        createdAt: base + i,
      }));
  });
}

/** Once their events are on disk, the plain-text copy goes. */
export function forgetSavedConversations(storage: KeyValueStorage): void {
  storage.removeItem(SAVED_KEY);
  storage.removeItem(SAVED_AT_KEY);
}
