import { Conversation, Message } from '@/types/chat';
import { getTextFromContent, stripImageDataFromMessages } from './messageUtils';
import { StoredConversation } from '@/hooks/useConversationSync';

const CONVERSATIONS_STORAGE_KEY = 'saved_conversations';
const CONVERSATIONS_UPDATED_AT_KEY = 'saved_conversations_updated_at';

const hasLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

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
    return typeof updatedAt === 'number' ? updatedAt : Date.now();
  }

  const timestamp = typeof updatedAt === 'number' ? updatedAt : Date.now();

  try {
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
    window.localStorage.setItem(CONVERSATIONS_UPDATED_AT_KEY, String(timestamp));
  } catch (error) {
    console.error('Error persisting conversations to storage:', error);
  }

  return timestamp;
};

const ensureUpdatedAtExists = () => {
  if (!hasLocalStorage()) return;
  if (!window.localStorage.getItem(CONVERSATIONS_UPDATED_AT_KEY)) {
    window.localStorage.setItem(CONVERSATIONS_UPDATED_AT_KEY, String(Date.now()));
  }
};

/**
 * Generates a title for a conversation based on the first user message
 * @param messages Array of messages in the conversation
 * @param fallbackTitle Default title to use if no user message found
 * @returns Generated title string
 */
export const generateConversationTitle = (messages: Message[], fallbackTitle: string): string => {
  const firstUserMessage = messages.find(m => m.role === 'user');
  if (firstUserMessage) {
    const messageText = getTextFromContent(firstUserMessage.content);
    return messageText.length > 30
      ? messageText.substring(0, 30) + '...'
      : messageText;
  }
  return fallbackTitle;
};

/**
 * Saves a conversation to localStorage with optimized message storage
 * @param conversations Current conversations array
 * @param activeConversationId ID of the conversation to save
 * @param messages Current messages in the conversation
 * @param syncToNostr Optional flag to trigger cloud sync
 * @param onSyncTrigger Optional callback when sync should be triggered
 * @returns Updated conversations array
 */
export const saveConversationToStorage = (
  conversations: Conversation[],
  activeConversationId: string,
  messages: Message[],
  syncToNostr?: boolean,
  onSyncTrigger?: (conversation: Conversation) => void
): Conversation[] => {
  if (!activeConversationId) return conversations;

  const updatedConversations = conversations.map(conversation => {
    if (conversation.id === activeConversationId) {
      let title = conversation.title;
      if (!title || title.startsWith('Conversation ')) {
        title = generateConversationTitle(messages, conversation.title);
      }

      const messagesToSave = stripImageDataFromMessages(messages);

      const updatedConversation = {
        ...conversation,
        title: title || conversation.title,
        messages: messagesToSave
      };

      if (syncToNostr && onSyncTrigger) {
        onSyncTrigger(updatedConversation);
      }

      return updatedConversation;
    }
    return conversation;
  });

  persistConversationsSnapshot(updatedConversations);
  return updatedConversations;
};

/**
 * Loads conversations from localStorage
 * @returns Array of conversations or empty array if none found
 */
export const loadConversationsFromStorage = (): Conversation[] => {
  if (!hasLocalStorage()) return [];
  try {
    const savedConversationsData = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
    if (!savedConversationsData) return [];

    const parsedConversations = JSON.parse(savedConversationsData);
    if (Array.isArray(parsedConversations)) {
      ensureUpdatedAtExists();
      return parsedConversations;
    }
  } catch (error) {
    console.error('Error loading conversations from storage:', error);
  }
  return [];
};

/**
 * Creates a new conversation
 * @param existingConversations Current conversations array
 * @param initialMessages Optional initial messages for the conversation
 * @param syncToNostr Optional flag to trigger cloud sync
 * @param onSyncTrigger Optional callback when sync should be triggered
 * @returns Object with new conversation and updated conversations array
 */
export const createNewConversation = (
  existingConversations: Conversation[],
  initialMessages: Message[] = [],
  syncToNostr?: boolean,
  onSyncTrigger?: (conversation: Conversation) => void
): {
  newConversation: Conversation;
  updatedConversations: Conversation[];
} => {
  const newId = Date.now().toString();
  const messagesToStore = stripImageDataFromMessages(initialMessages);
  const newConversation: Conversation = {
    id: newId,
    title: `Conversation ${existingConversations.length + 1}`,
    messages: messagesToStore
  };

  const updatedConversations = [...existingConversations, newConversation];
  persistConversationsSnapshot(updatedConversations);

  if (syncToNostr && onSyncTrigger) {
    onSyncTrigger(newConversation);
  }

  return {
    newConversation,
    updatedConversations
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
  const updatedConversations = conversations.filter(c => c.id !== conversationId);
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
  return conversations.find(c => c.id === conversationId);
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
 * @param syncToNostr Optional flag to trigger cloud sync
 * @param onSyncTrigger Optional callback when sync should be triggered
 * @returns Updated conversations array
 */
export const updateConversation = (
  conversations: Conversation[],
  conversationId: string,
  updates: Partial<Conversation>,
  syncToNostr?: boolean,
  onSyncTrigger?: (conversation: Conversation) => void
): Conversation[] => {
  const updatedConversations = conversations.map(conversation => {
    if (conversation.id === conversationId) {
      const updatedConversation = { ...conversation, ...updates };
      
      if (syncToNostr && onSyncTrigger) {
        onSyncTrigger(updatedConversation);
      }
      
      return updatedConversation;
    }
    return conversation;
  });

  persistConversationsSnapshot(updatedConversations);
  return updatedConversations;
};

/**
 * Syncs a conversation to Nostr using the provided sync function
 * @param conversation The conversation to sync
 * @param syncFn Function that handles the actual Nostr sync operation
 * @throws Error if sync fails
 */
export const syncConversationToNostr = async (
  conversation: Conversation,
  syncFn: (conv: Conversation) => Promise<void>
): Promise<void> => {
  try {
    await syncFn(conversation);
  } catch (error) {
    console.error('Failed to sync conversation to Nostr:', error);
    throw error;
  }
};

/**
 * Loads conversations from Nostr with fallback to localStorage
 * @param loadFn Function that handles loading from Nostr
 * @returns Array of stored conversations, falls back to local storage on error
 */
export const loadConversationsFromNostr = async (
  loadFn: () => Promise<StoredConversation[]>
): Promise<StoredConversation[]> => {
  try {
    return await loadFn();
  } catch (error) {
    console.error('Failed to load conversations from Nostr:', error);
    return loadConversationsFromStorage().map(conv => ({
      ...conv,
      createdAt: conv.createdAt || Date.now(),
      updatedAt: conv.updatedAt || Date.now(),
      messageCount: conv.messages.length,
      lastMessageAt: conv.messages.length > 0 ? Date.now() : undefined
    }));
  }
};

/**
 * Merges local and cloud conversations using timestamp-based conflict resolution
 * Local conversations take precedence when they have newer updatedAt timestamps
 * @param localConversations Conversations from localStorage
 * @param cloudConversations Conversations from Nostr
 * @returns Merged array with most recent versions of each conversation
 */
export const mergeConversations = (
  localConversations: Conversation[],
  cloudConversations: StoredConversation[]
): StoredConversation[] => {
  const mergedMap = new Map<string, StoredConversation>();
  
  cloudConversations.forEach(conv => mergedMap.set(conv.id, conv));
  
  localConversations.forEach(conv => {
    const existing = mergedMap.get(conv.id);
    const storedConv: StoredConversation = {
      ...conv,
      createdAt: conv.createdAt || Date.now(),
      updatedAt: conv.updatedAt || Date.now(),
      messageCount: conv.messages.length,
      lastMessageAt: conv.messages.length > 0 ? Date.now() : undefined
    };
    
    if (!existing || storedConv.updatedAt > existing.updatedAt) {
      mergedMap.set(conv.id, storedConv);
    }
  });

  return Array.from(mergedMap.values());
};

/**
 * Removes duplicate conversations keeping the most recently updated version
 * @param conversations Array of conversations that may contain duplicates
 * @returns Deduplicated array sorted by most recent updatedAt timestamp
 */
export const deduplicateConversations = (
  conversations: StoredConversation[]
): StoredConversation[] => {
  const seen = new Set<string>();
  const deduplicated: StoredConversation[] = [];
  
  conversations
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach(conv => {
      if (!seen.has(conv.id)) {
        seen.add(conv.id);
        deduplicated.push(conv);
      }
    });
  
  return deduplicated;
};
