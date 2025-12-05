import { useState, useEffect, useCallback, useRef } from 'react';
import { firstValueFrom, map, filter, timeout } from 'rxjs';
import { Conversation, Message } from '@/types/chat';
import {
  loadConversationsFromStorage,
  saveConversationToStorage,
  createNewConversationWithMap,
  deleteConversationFromStorage,
  clearAllConversations,
  sortConversationsByRecentActivity
} from '@/utils/conversationUtils';
import { getTextFromContent } from '@/utils/messageUtils';
import { loadActiveConversationId, saveActiveConversationId, loadLastUsedModel } from '@/utils/storageUtils';
import { useChatSync } from './useChatSync';
import { processInnerEvent, decryptPnsEventToInner } from '@/utils/eventProcessing';
import { eventStore } from '@/lib/applesauce-core';
import { useChatSync1081, derivedPnsKeys$ } from './useChatSync1081';
import { PnsKeys, SALT_PNS } from '@/lib/pns';

export interface UseConversationStateReturn {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  activeConversationId: string | null;
  messages: Message[];
  editedMessages: Message[];
  editingMessageIndex: number | null;
  editingContent: string;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  setEditedMessages: (messages: Message[]) => void;
  setEditingMessageIndex: (index: number | null) => void;
  setEditingContent: (content: string) => void;
  createNewConversationHandler: (initialMessages?: Message[], timestamp?: string) => string;
  loadConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string, e: React.MouseEvent) => void;
  clearConversations: () => void;
  startEditingMessage: (index: number) => void;
  cancelEditing: () => void;
  saveConversationById: (conversationId: string, newMessages: Message[]) => void;
  appendMessageToConversation: (conversationId: string, message: Message) => void;
  getActiveConversationId: () => string | null;
  isSyncing: boolean;
  currentPns: PnsKeys | null;
  createAndStoreChatEvent: (
    conversationId: string,
    message: Message
  ) => Promise<string | null>;
}

/**
 * Custom hook for managing conversation and message state
 * Handles conversation CRUD operations, message state management,
 * active conversation tracking, and conversation persistence
 */
export const useConversationState = (): UseConversationStateReturn => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editedMessages, setEditedMessages] = useState<Message[]>([]);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const activeConversationIdRef = useRef<string | null>(null);
  const conversationsMapRef = useRef<Map<string, Conversation>>(new Map());
  const processedEventIdsRef = useRef<Set<string>>(new Set());

  const { isSyncing, publishMessage, chatSyncEnabled } = useChatSync();
  const { derivedPnsEvents: syncedEvents, loading1081: loading, currentPnsKeys, triggerProcessStored1081Events } = useChatSync1081()

  // Load conversations and active conversation ID from storage on mount
  useEffect(() => {
    const loadedConversations = loadConversationsFromStorage();
    setConversations(loadedConversations);
    setConversationsLoaded(true);
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Process synced events from useChatSyncProMax
  useEffect(() => {
    if (!currentPnsKeys) {
      return;
    }

    let hasNewEvents = false;

    const eventsToLoad = eventStore.getByFilters({ kinds: [1080] });
    eventsToLoad.forEach((event) => {
      // Skip already processed events
      if (processedEventIdsRef.current.has(event.id)) {
        return;
      }

      // Decrypt and process the event
      const innerEvent = decryptPnsEventToInner(event, currentPnsKeys);
      if (!innerEvent) {
        return;
      }

      // Update conversations map
      processInnerEvent(conversationsMapRef.current, innerEvent);
      processedEventIdsRef.current.add(event.id);
      hasNewEvents = true;
    });

    // Update state with new conversations array if we processed any new events
    if (hasNewEvents) {
      const updatedConversations = Array.from(conversationsMapRef.current.values());
      const sortedConversations = sortConversationsByRecentActivity(updatedConversations);
      setConversations(sortedConversations);

      // Update messages for active conversation
      const currentActiveId = activeConversationIdRef.current;
      if (currentActiveId) {
        const activeConv = conversationsMapRef.current.get(currentActiveId);
        if (activeConv) {
          const { messages: main, editedMessages: edited } = separateMessagesWithEdits(activeConv.messages);
          setMessages(main);
          setEditedMessages(edited);
        }
      }
    }
  }, [syncedEvents, currentPnsKeys, loading]);

  // Set editing content when editing message index changes
  useEffect(() => {
    if (editingMessageIndex !== null && messages[editingMessageIndex]) {
      const messageText = getTextFromContent(messages[editingMessageIndex].content);
      setEditingContent(messageText);
    }
  }, [editingMessageIndex, messages]);

  // Reset inline editing state when switching conversations
  useEffect(() => {
    setEditingMessageIndex(null);
    setEditingContent('');
  }, [activeConversationId]);

  // Wrapper function to set active conversation ID and save to localStorage
  const setActiveConversationIdWithStorage = useCallback((conversationId: string | null) => {
    setActiveConversationId(conversationId);
    saveActiveConversationId(conversationId);
  }, []);

  const createNewConversationHandler = useCallback((initialMessages: Message[] = [], timestamp?: string) => {
    let createdId: string = '';
    setConversations(prevConversations => {
      const { newConversation, updatedConversations } = createNewConversationWithMap(conversationsMapRef.current, initialMessages, timestamp);
      createdId = newConversation.id;
      setActiveConversationIdWithStorage(newConversation.id);
      // Set messages to the initial messages (empty array if none provided)
      const { messages: main, editedMessages: edited } = separateMessagesWithEdits(initialMessages);
      setMessages(main);
      setEditedMessages(edited);
      return updatedConversations;
    });
    return createdId;
  }, []);

  const loadConversation = useCallback((conversationId: string) => {
    setConversations(prevConversations => {
      const conversation = conversationsMapRef.current.get(conversationId);
      if (conversation) {
        setActiveConversationIdWithStorage(conversationId);
        console.log("rdlogs: loadConversation", conversationId, conversation)
        const { messages: main, editedMessages: edited } = separateMessagesWithEdits(conversation.messages);
        setMessages(main);
        setEditedMessages(edited);
      }
      return prevConversations;
    });
  }, [setActiveConversationIdWithStorage]);

  const deleteConversation = useCallback((conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    setConversations(prevConversations => {
      const updatedConversations = deleteConversationFromStorage(prevConversations, conversationId);
      
      if (conversationId === activeConversationId) {
        setActiveConversationIdWithStorage(null);
        setMessages([]);
      }
      
      return updatedConversations;
    });
  }, [activeConversationId, setActiveConversationIdWithStorage]);

  const clearConversations = useCallback(() => {
    setConversations([]);
    setActiveConversationIdWithStorage(null);
    setMessages([]);
    clearAllConversations();
  }, [setActiveConversationIdWithStorage]);

  const startEditingMessage = useCallback((index: number) => {
    setEditingMessageIndex(index);
    const messageText = getTextFromContent(messages[index].content);
    setEditingContent(messageText);
    // Store the original message content for preserving attachments
    if (typeof messages[index].content !== 'string') {
      // Already an array with possible attachments
    }
  }, [messages]);

  const cancelEditing = useCallback(() => {
    setEditingMessageIndex(null);
    setEditingContent('');
  }, []);

  const appendMessageToConversation = useCallback((conversationId: string, message: Message) => {
    // Get or create conversation in map
    let conversation = conversationsMapRef.current.get(conversationId);
    
    if (!conversation) {
      // Create new conversation if it doesn't exist
      conversation = {
        id: conversationId,
        title: 'New Chat',
        messages: [],
      };
      conversationsMapRef.current.set(conversationId, conversation);
    }
    
    // Append message to conversation
    conversation.messages.push(message);
    
    // Update state with new conversation array
    const updatedConversations = Array.from(conversationsMapRef.current.values());
    const sortedConversations = sortConversationsByRecentActivity(updatedConversations);
    setConversations(sortedConversations);
    
    // Update messages if this is the active conversation
    if (activeConversationIdRef.current === conversationId) {
      const { messages: main, editedMessages: edited } = separateMessagesWithEdits(conversation.messages);
      setMessages(main);
      setEditedMessages(edited);
    }
    
    // Save to storage
    saveConversationToStorage(sortedConversations, conversationId, conversation.messages);
  }, []);

  const createAndStoreChatEvent = useCallback(async (
    conversationId: string,
    message: Message
  ): Promise<string | null> => {
    console.log("Createing mes 1081", currentPnsKeys);
    if (currentPnsKeys) {
      return await publishMessage(conversationId, message, currentPnsKeys, appendMessageToConversation);
    } else {
      console.log('[useConversationState] No currentPnsKeys, triggering stored 1081 events processing')
      triggerProcessStored1081Events();

      // Wait for keys to be derived
      try {
        const keys = await firstValueFrom(
          derivedPnsKeys$.pipe(
            map(keysMap => {
               // Find the first PNS keys with SALT_PNS
               return Array.from(keysMap.values()).find(pnsKeys => pnsKeys.salt === SALT_PNS)
            }),
            filter(keys => !!keys),
            timeout(5000) // Timeout after 5 seconds
          )
        )
        
        if (keys) {
           return await publishMessage(conversationId, message, keys, appendMessageToConversation);
        }
      } catch (err) {
        console.error("Failed to derive keys in time", err)
        return null
      }
    }
    return null;
  }, [publishMessage, currentPnsKeys, appendMessageToConversation, triggerProcessStored1081Events]);

  return {
    conversations,
    activeConversationId,
    messages,
    editedMessages,
    editingMessageIndex,
    editingContent,
    setConversations,
    setActiveConversationId: setActiveConversationIdWithStorage,
    setMessages,
    setEditedMessages,
    setEditingMessageIndex,
    setEditingContent,
    createNewConversationHandler,
    loadConversation,
    deleteConversation,
    clearConversations,
    startEditingMessage,
    cancelEditing,
    saveConversationById: (conversationId: string, newMessages: Message[]) => {
      setConversations(prevConversations => {
        return saveConversationToStorage(prevConversations, conversationId, newMessages);
      });
    },
    appendMessageToConversation,
    getActiveConversationId: () => loadActiveConversationId(),
    conversationsLoaded,
    isSyncing,
    currentPns: currentPnsKeys,
    createAndStoreChatEvent
  };
};

function separateMessagesWithEdits(messages: Message[]) {
  const messagesById = new Map<string, Message>();
  const childrenMap = new Map<string, Message[]>();

  // Index messages
  messages.forEach(msg => {
    if (msg._eventId) {
      messagesById.set(msg._eventId, msg);
    }
  });

  // Build children map
  messages.forEach(msg => {
    const prevId = msg._prevId;
    if (prevId && messagesById.has(prevId)) {
      if (!childrenMap.has(prevId)) {
        childrenMap.set(prevId, []);
      }
      childrenMap.get(prevId)!.push(msg);
    }
  });

  const mainMessages: Message[] = [];
  const editedMessages: Message[] = [];

  // Helper to collect all descendants as edited
  const collectEditedSubtree = (msg: Message) => {
    editedMessages.push(msg);
    if (msg._eventId) {
      const children = childrenMap.get(msg._eventId);
      if (children) {
        children.forEach(child => collectEditedSubtree(child));
      }
    }
  };

  // Recursive function to traverse the main thread
  const processThread = (currentMsg: Message) => {
    mainMessages.push(currentMsg);
    
    if (!currentMsg._eventId) return;

    const children = childrenMap.get(currentMsg._eventId);
    if (!children || children.length === 0) return;

    // Sort children by creation time, newest first
    children.sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));

    const newestChild = children[0];
    const olderChildren = children.slice(1);

    // Process the newest child as part of main thread
    processThread(newestChild);

    // All older siblings and their descendants are edited
    olderChildren.forEach(child => collectEditedSubtree(child));
  };

  // Find roots (messages with no prevId OR prevId not in messages)
  const roots: Message[] = [];
  messages.forEach(msg => {
    if (!msg._prevId || !messagesById.has(msg._prevId)) {
      roots.push(msg);
    }
  });

  if (roots.length > 0) {
    // Sort roots by creation time
    roots.sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
    
    const newestRoot = roots[0];
    const olderRoots = roots.slice(1);
    
    processThread(newestRoot);
    olderRoots.forEach(root => collectEditedSubtree(root));
  }
  console.log("Edited", mainMessages, editedMessages);

  return { messages: mainMessages, editedMessages };
}

