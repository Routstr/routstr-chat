import { Event } from "nostr-tools";
import { Conversation, Message } from "@/types/chat";
import { PnsKeys, decryptPnsEvent, KIND_PNS } from "@/lib/pns";
import { getTextFromContent } from "./messageUtils";

// Custom Kinds
const KIND_CHAT_INNER = 20001;

/**
 * Represents a decrypted inner event from PNS
 */
export interface InnerEvent {
  id: string; // PNS event ID for tracking
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * Metadata extracted from an inner event
 */
export interface ConversationMetadata {
  conversationId: string;
  role: string;
  createdAt: number;
  prevId?: string;
  model?: string;
}

/**
 * Decrypts a single PNS event (Kind 1080) to an inner event (Kind 20001)
 * @param pnsEvent The encrypted PNS event
 * @param pnsKeys The PNS keys for decryption
 * @returns The decrypted inner event or null if decryption fails
 */
export function decryptPnsEventToInner(
  pnsEvent: Event,
  pnsKeys: PnsKeys,
): InnerEvent | null {
  try {
    // Decrypt PNS Event -> Inner Event
    const inner = decryptPnsEvent(pnsEvent, pnsKeys);

    if (!inner) {
      // Log when decryption returns null (already logged in decryptPnsEvent)
      return null;
    }

    if (inner.kind !== KIND_CHAT_INNER) {
      console.warn("PNS event decrypted but not a chat inner event:", {
        eventId: pnsEvent.id,
        actualKind: inner.kind,
        expectedKind: KIND_CHAT_INNER,
      });
      return null;
    }

    // Attach the PNS event ID to track the chain
    return {
      ...inner,
      id: pnsEvent.id,
    };
  } catch (error) {
    console.warn("Unexpected error in decryptPnsEventToInner:", {
      eventId: pnsEvent.id,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

/**
 * Extracts conversation metadata from an inner event
 * @param innerEvent The decrypted inner event
 * @returns Metadata including conversation ID, role, timestamps
 */
export function extractConversationMetadata(
  innerEvent: InnerEvent,
): ConversationMetadata | null {
  const dTag = innerEvent.tags.find((t) => t[0] === "d");
  if (!dTag || !dTag[1]) {
    console.warn("Inner event missing d tag:", innerEvent);
    return null;
  }

  const roleTag = innerEvent.tags.find((t) => t[0] === "role");
  const role = roleTag ? roleTag[1] : "user";

  const prevTag = innerEvent.tags.find((t) => t[0] === "e");
  const prevId = prevTag ? prevTag[1] : undefined;

  const modelTag = innerEvent.tags.find((t) => t[0] === "model");
  const model = modelTag ? modelTag[1] : undefined;

  return {
    conversationId: dTag[1],
    role,
    createdAt: innerEvent.created_at,
    prevId,
    model,
  };
}

/**
 * Converts an inner event to a Message object
 * @param innerEvent The decrypted inner event
 * @returns A Message object with metadata
 */
export function innerEventToMessage(innerEvent: InnerEvent): Message {
  // Parse content - try JSON first, fall back to string
  let content = innerEvent.content;
  try {
    const parsed = JSON.parse(innerEvent.content);
    if (typeof parsed === "object") {
      content = parsed;
    }
  } catch {
    // Keep as string if JSON parse fails
  }

  const metadata = extractConversationMetadata(innerEvent);

  const message: Message = {
    role: metadata?.role || "user",
    content,
    _eventId: innerEvent.id,
    _prevId: metadata?.prevId,
    _createdAt: innerEvent.created_at,
    _modelId: metadata?.model,
    satsSpent: innerEvent.tags.find((t) => t[0] === "sats")?.[1]
      ? parseFloat(innerEvent.tags.find((t) => t[0] === "sats")?.[1] as string)
      : undefined,
  };

  return message;
}
/**
 * Sorts messages by following the _prevId chain
 * First message has _prevId of "000000", each subsequent message's _prevId
 * points to the previous message's _eventId
 * @param messages Array of messages to sort
 * @returns Sorted array of messages
 */
function sortMessagesByPrevIdChain(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    // 1. Sort by timestamp
    const aTime = a._createdAt || 0;
    const bTime = b._createdAt || 0;

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    // 2. If timestamps are equal, check prevId/eventId relationship
    // If a is the previous message of b (b points to a), a comes first
    if (b._prevId === a._eventId && a._eventId) {
      return -1;
    }
    // If b is the previous message of a (a points to b), b comes first
    if (a._prevId === b._eventId && b._eventId) {
      return 1;
    }

    // 3. If can't sort by prevId, sort "user" messages before others
    if (a.role === "user" && b.role !== "user") {
      return -1;
    }
    if (b.role === "user" && a.role !== "user") {
      return 1;
    }

    return 0;
  });
}

/**
 * Adds a message to a conversation, maintaining sort order
 * @param conversation The conversation to update
 * @param message The message to add
 * @param options Configuration options
 * @returns Updated conversation
 */
export function addMessageToConversation(
  conversation: Conversation,
  message: Message,
  options: { sortMessages: boolean } = { sortMessages: true },
): Conversation {
  // Check if message already exists (by _eventId)
  const existingIndex = conversation.messages.findIndex(
    (m) => m._eventId === message._eventId,
  );

  let updatedMessages: Message[];
  if (existingIndex !== -1) {
    // Update existing message
    updatedMessages = conversation.messages.map((m, idx) =>
      idx === existingIndex ? message : m,
    );
  } else {
    // Add new message
    updatedMessages = [...conversation.messages, message];
  }
  // Sort messages by _prevId chain if requested
  if (options.sortMessages) {
    updatedMessages = sortMessagesByPrevIdChain(updatedMessages);
  }

  return {
    ...conversation,
    messages: updatedMessages,
  };
}

/**
 * Generates a conversation title from a message
 * @param message The message to generate title from
 * @param maxLength Maximum length of the title
 * @returns Generated title string
 */
export function generateTitleFromMessage(
  message: Message,
  maxLength: number = 50,
): string {
  let text: string;

  if (typeof message.content === "string") {
    text = message.content;
  } else {
    // Extract text from multimodal content
    text = getTextFromContent(message.content);
  }

  // Trim and truncate
  text = text.trim();
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + "...";
  }

  return text || "New Conversation";
}

/**
 * Updates conversation title from the first message
 * @param conversation The conversation to update
 * @returns Conversation with updated title
 */
export function updateConversationTitle(
  conversation: Conversation,
): Conversation {
  // Messages are already sorted, use the first one
  if (conversation.messages.length === 0) {
    return conversation;
  }

  const firstMessage = conversation.messages[0];
  const newTitle = generateTitleFromMessage(firstMessage);

  return {
    ...conversation,
    title: newTitle,
  };
}

/**
 * Creates a new conversation from metadata
 * @param conversationId The unique conversation ID
 * @param initialMessage Optional initial message
 * @returns A new Conversation object
 */
export function createConversation(
  conversationId: string,
  initialMessage?: Message,
): Conversation {
  const conversation: Conversation = {
    id: conversationId,
    title: initialMessage
      ? generateTitleFromMessage(initialMessage)
      : "New Conversation",
    messages: initialMessage ? [initialMessage] : [],
  };

  return conversation;
}

/**
 * Processes a decrypted inner event and updates the conversations map
 * @param conversationsMap Map of conversations by ID
 * @param innerEvent The decrypted inner event
 * @returns Updated conversations map
 */
export function processInnerEvent(
  conversationsMap: Map<string, Conversation>,
  innerEvent: InnerEvent,
): Map<string, Conversation> {
  const metadata = extractConversationMetadata(innerEvent);
  if (!metadata) {
    return conversationsMap;
  }

  const message = innerEventToMessage(innerEvent);
  let conversation = conversationsMap.get(metadata.conversationId);

  if (!conversation) {
    // Create new conversation
    conversation = createConversation(metadata.conversationId, message);
  } else {
    // Add message to existing conversation
    conversation = addMessageToConversation(conversation, message);

    // Update title from the first message
    conversation = updateConversationTitle(conversation);
  }

  conversationsMap.set(metadata.conversationId, conversation);
  return conversationsMap;
}
