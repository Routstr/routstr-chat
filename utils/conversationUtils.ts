import { Conversation, Message } from "@/types/chat";
import { getTextFromContent, stripImageDataFromMessages } from "./messageUtils";

const CONVERSATIONS_STORAGE_KEY = "saved_conversations";
const CONVERSATIONS_UPDATED_AT_KEY = "saved_conversations_updated_at";

const hasLocalStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const persistConversationsSnapshot = (
  conversations: Conversation[],
  updatedAt?: number
): number => {
  if (!hasLocalStorage()) {
    return typeof updatedAt === "number" ? updatedAt : Date.now();
  }

  const timestamp = typeof updatedAt === "number" ? updatedAt : Date.now();

  try {
    window.localStorage.setItem(
      CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(conversations)
    );
    window.localStorage.setItem(
      CONVERSATIONS_UPDATED_AT_KEY,
      String(timestamp)
    );
  } catch (error) {
    console.error("Error persisting conversations to storage:", error);
  }
  console.log("persis", conversations);

  return timestamp;
};

/**
 * Generates a title for a conversation based on the first user message
 * @param messages Array of messages in the conversation
 * @param fallbackTitle Default title to use if no user message found
 * @returns Generated title string
 */
export const generateConversationTitle = (
  messages: Message[],
  fallbackTitle: string
): string => {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (firstUserMessage) {
    const messageText = getTextFromContent(firstUserMessage.content);
    return messageText.length > 30
      ? messageText.substring(0, 30) + "..."
      : messageText;
  }
  return fallbackTitle;
};

/**
 * Saves a conversation to localStorage with optimized message storage
 * @param conversations Current conversations array
 * @param activeConversationId ID of the conversation to save
 * @param messages Current messages in the conversation
 * @returns Updated conversations array
 */
export const saveConversationToStorage = (
  conversations: Conversation[],
  activeConversationId: string,
  messages: Message[]
): Conversation[] => {
  if (!activeConversationId) return conversations;

  const updatedConversations = conversations.map((conversation) => {
    if (conversation.id === activeConversationId) {
      // Generate title if needed
      let title = conversation.title;
      if (!title || title.startsWith("Conversation ")) {
        title = generateConversationTitle(messages, conversation.title);
      }

      // Strip image data from messages before saving
      const messagesToSave = stripImageDataFromMessages(messages);

      return {
        ...conversation,
        title: title || conversation.title,
        messages: messagesToSave,
      };
    }
    return conversation;
  });

  // Sort by most recent activity
  const sortedConversations =
    sortConversationsByRecentActivity(updatedConversations);
  console.log(sortedConversations);

  persistConversationsSnapshot(sortedConversations);
  return sortedConversations;
};

/**
 * Loads conversations from localStorage
 * @returns Array of conversations or empty array if none found
 */
export const loadConversationsFromStorage = (): Conversation[] => {
  if (!hasLocalStorage()) return [];
  try {
    const savedConversationsData = window.localStorage.getItem(
      CONVERSATIONS_STORAGE_KEY
    );
    if (!savedConversationsData) return [];

    const parsedConversations = JSON.parse(savedConversationsData);
    if (Array.isArray(parsedConversations)) {
      return parsedConversations;
    }
  } catch (error) {
    console.error("Error loading conversations from storage:", error);
  }
  return [];
};

/**
 * Deletes a conversation from storage
 * @param conversations Current conversations array
 * @param conversationId ID of conversation to delete
 * @returns Updated conversations array
 */
export const deleteConversationFromStorage = (
  conversations: Conversation[],
  conversationId: string
): Conversation[] => {
  const updatedConversations = conversations.filter(
    (c) => c.id !== conversationId
  );
  console.log("insdie", updatedConversations);
  persistConversationsSnapshot(updatedConversations);
  return updatedConversations;
};

/**
 * Clears all conversations from storage
 */
export const clearAllConversations = (): void => {
  if (!hasLocalStorage()) return;
  window.localStorage.removeItem(CONVERSATIONS_STORAGE_KEY);
  window.localStorage.removeItem(CONVERSATIONS_UPDATED_AT_KEY);
};

/**
 * Sorts conversations by most recent activity based on message creation timestamps
 * @param conversations Array of conversations to sort
 * @returns Sorted conversations array (most recent first)
 */
export const sortConversationsByRecentActivity = (
  conversations: Conversation[]
): Conversation[] => {
  return conversations.sort((a, b) => {
    // Check if conversations have empty messages
    const aIsEmpty = a.messages.length === 0;
    const bIsEmpty = b.messages.length === 0;

    // If both are empty or both have messages, sort by timestamp
    if (aIsEmpty === bIsEmpty) {
      const aTime = Math.max(...a.messages.map((m) => m._createdAt || 0));
      const bTime = Math.max(...b.messages.map((m) => m._createdAt || 0));
      return bTime - aTime; // Sort in descending order (most recent first)
    }

    // If one is empty and the other is not, empty comes first
    return aIsEmpty ? -1 : 1;
  });
};
