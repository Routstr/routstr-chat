import { Conversation, Message } from "@/types/chat";
import { getTextFromContent, stripImageDataFromMessages } from "./messageUtils";
import { loadActiveConversationId } from "./storageUtils";
import { createConversation } from "./eventProcessing";

const CONVERSATIONS_STORAGE_KEY = "saved_conversations";
const CONVERSATIONS_UPDATED_AT_KEY = "saved_conversations_updated_at";

const hasLocalStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const getConversationsUpdatedAt = (): number => {
  if (!hasLocalStorage()) return 0;
  const raw = window.localStorage.getItem(CONVERSATIONS_UPDATED_AT_KEY);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

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

const ensureUpdatedAtExists = () => {
  if (!hasLocalStorage()) return;
  if (!window.localStorage.getItem(CONVERSATIONS_UPDATED_AT_KEY)) {
    window.localStorage.setItem(
      CONVERSATIONS_UPDATED_AT_KEY,
      String(Date.now())
    );
  }
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
      ensureUpdatedAtExists();
      return parsedConversations;
    }
  } catch (error) {
    console.error("Error loading conversations from storage:", error);
  }
  return [];
};

/**
 * Creates a new conversation
 * @param existingConversations Current conversations array
 * @param initialMessages Optional initial messages for the conversation
 * @returns Object with new conversation and updated conversations array
 */
export const createAndStoreNewConversation = (
  existingConversations: Conversation[],
  initialMessages: Message[] = [],
  timestamp?: string
): {
  newConversation: Conversation;
  updatedConversations: Conversation[];
} => {
  // First check if there's an existing conversation with no messages
  const emptyConversation = existingConversations.find(
    (conv) => conv.messages.length === 0
  );

  if (emptyConversation) {
    // Return the existing empty conversation
    return {
      newConversation: emptyConversation,
      updatedConversations: existingConversations,
    };
  }

  // If no empty conversation found, create a new one
  const newId = timestamp ?? Date.now().toString();
  const messagesToStore = stripImageDataFromMessages(initialMessages);
  const newConversation: Conversation = {
    id: newId,
    title: `Conversation ${existingConversations.length + 1}`,
    messages: messagesToStore,
  };

  const updatedConversations = [...existingConversations, newConversation];
  console.log("insdie", updatedConversations);
  persistConversationsSnapshot(updatedConversations);

  return {
    newConversation,
    updatedConversations,
  };
};

/**
 * Creates a new conversation using a Map of conversations
 * @param conversationsMap Current conversations Map
 * @param initialMessages Optional initial messages for the conversation
 * @param timestamp Optional timestamp for the conversation ID
 * @returns Object with new conversation and updated conversations array
 */
export const createNewConversationWithMap = (
  conversationsMap: Map<string, Conversation>,
  initialMessages: Message[] = [],
  timestamp?: string
): {
  newConversation: Conversation;
  updatedConversations: Conversation[];
} => {
  // Convert Map to array to check for empty conversations
  const existingConversations = Array.from(conversationsMap.values());

  // First check if there's an existing conversation with no messages
  const emptyConversation = existingConversations.find(
    (conv) => conv.messages.length === 0
  );

  if (emptyConversation) {
    // Return the existing empty conversation
    return {
      newConversation: emptyConversation,
      updatedConversations: existingConversations,
    };
  }

  // If no empty conversation found, create a new one
  const newId = timestamp ?? Date.now().toString();
  const messagesToStore = stripImageDataFromMessages(initialMessages);
  const newConversation: Conversation = createConversation(
    newId,
    messagesToStore[0]
  );

  // Add the new conversation to the map
  conversationsMap.set(newId, newConversation);

  // Convert the updated map back to an array
  const updatedConversations = sortConversationsByRecentActivity(
    Array.from(conversationsMap.values())
  );
  console.log("inside createNewConversationWithMap", updatedConversations);

  return {
    newConversation,
    updatedConversations,
  };
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
 * Finds a conversation by ID
 * @param conversations Array of conversations to search
 * @param conversationId ID to search for
 * @returns Found conversation or undefined
 */
export const findConversationById = (
  conversations: Conversation[],
  conversationId: string
): Conversation | undefined => {
  return conversations.find((c) => {
    if (c.id === conversationId) return c;
  });
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
 * Updates a specific conversation in the array
 * @param conversations Current conversations array
 * @param conversationId ID of conversation to update
 * @param updates Partial conversation object with updates
 * @returns Updated conversations array
 */
export const updateConversation = (
  conversations: Conversation[],
  conversationId: string,
  updates: Partial<Conversation>
): Conversation[] => {
  const updatedConversations = conversations.map((conversation) => {
    if (conversation.id === conversationId) {
      return { ...conversation, ...updates };
    }
    return conversation;
  });

  console.log("insdie", updatedConversations);
  persistConversationsSnapshot(updatedConversations);
  return updatedConversations;
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

/**
 * Saves an event ID to a message in storage by matching the prevId
 * @param conversationId ID of the conversation
 * @param prevId The previous event ID to match against the message's _prevId
 * @param eventId The event ID to add to the matched message
 * @returns Updated conversations array or null if not found
 */
export const saveEventIdInStorage = (
  conversationId: string,
  message: Message,
  eventId: string
): Conversation[] | null => {
  // Load conversations from storage
  const conversations = loadConversationsFromStorage();

  // Find the target conversation
  const targetConversation = findConversationById(
    conversations,
    conversationId
  );
  if (!targetConversation) {
    console.error(`Conversation with ID ${conversationId} not found`);
    return null;
  }

  // Append the message to the end of the target conversation
  const updatedConversations = conversations.map((conversation) => {
    if (conversation.id === conversationId) {
      return {
        ...conversation,
        messages: [...conversation.messages, { ...message, _eventId: eventId }],
      };
    }
    return conversation;
  });

  console.log("insdie EVNETS", updatedConversations);

  // Persist the updated conversations
  persistConversationsSnapshot(updatedConversations);
  return updatedConversations;
};
