import { useState, useEffect, useCallback, useRef } from "react";
import { firstValueFrom, map, filter, timeout } from "rxjs";
import { Conversation, Message } from "@/types/chat";
import {
  loadConversationsFromStorage,
  saveConversationToStorage,
  createNewConversationWithMap,
  deleteConversationFromStorage,
  clearAllConversations,
  sortConversationsByRecentActivity,
  persistConversationsSnapshot,
} from "@/utils/conversationUtils";
import {
  getTextFromContent,
  stripImageDataFromSingleMessage,
} from "@/utils/messageUtils";
import {
  loadActiveConversationId,
  saveActiveConversationId,
  loadLastUsedModel,
  loadSatsSpentMap,
  saveSatsSpent,
  loadAutoDeleteConversations,
} from "@/utils/storageUtils";
import { useChatSync } from "./useChatSync";
import {
  processInnerEvent,
  decryptPnsEventToInner,
} from "@/utils/eventProcessing";
import { eventStore } from "@/lib/applesauce-core";
import { useChatSync1081, derivedPnsKeys$ } from "./useChatSync1081";
import { PnsKeys, SALT_PNS, createPnsDeletionEvent } from "@/lib/pns";
import { SyncDirection } from "applesauce-relay";
import { useDeletionSync } from "./useDeletionSync";

export interface UseConversationStateReturn {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  activeConversationId: string | null;
  messages: Message[];
  editingMessageIndex: number | null;
  editingContent: string;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  setEditingMessageIndex: (index: number | null) => void;
  setEditingContent: (content: string) => void;
  createNewConversationHandler: (
    initialMessages?: Message[],
    timestamp?: string
  ) => string;
  startNewConversation: () => void;
  loadConversation: (conversationId: string) => void;
  deleteConversation: (
    conversationId: string,
    e: React.MouseEvent
  ) => Promise<void>;
  clearConversations: () => void;
  startEditingMessage: (index: number) => void;
  cancelEditing: () => void;
  saveConversationById: (
    conversationId: string,
    newMessages: Message[]
  ) => void;
  appendMessageToConversation: (
    conversationId: string,
    message: Message
  ) => void;
  getActiveConversationId: () => string | null;
  getLastNonSystemMessageEventId: (
    conversationId: string,
    lastMessageRole?: string[]
  ) => string;
  updateLastMessageSatsSpent: (
    conversationId: string,
    satsSpent: number
  ) => void;
  isSyncing: boolean;
  currentPns: PnsKeys | null;
  createAndStoreChatEvent: (
    conversationId: string,
    message: Message
  ) => Promise<string | null>;
  syncWithNostr: () => Promise<void>;
}

/**
 * Custom hook for managing conversation and message state
 * Handles conversation CRUD operations, message state management,
 * active conversation tracking, and conversation persistence
 */
export const useConversationState = (): UseConversationStateReturn => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(
    null
  );
  const [editingContent, setEditingContent] = useState("");

  const activeConversationIdRef = useRef<string | null>(null);
  const conversationsMapRef = useRef<Map<string, Conversation>>(new Map());
  const processedEventIdsRef = useRef<Set<string>>(new Set());
  const migrationAttemptedRef = useRef(false);
  const autoDeleteAttemptedRef = useRef(false);

  const {
    isSyncing: isPublishing,
    publishMessage,
    chatSyncEnabled,
    migrateConversations,
  } = useChatSync();
  const {
    derivedPnsEvents: syncedEvents,
    loading1081,
    loadingDerivedPns,
    currentPnsKeys,
    triggerProcessStored1081Events,
    triggerDerivedPnsSync,
  } = useChatSync1081();
  const { performDeletionSync } = useDeletionSync();

  const isSyncing = isPublishing || loading1081 || loadingDerivedPns;

  const syncWithNostr = useCallback(async () => {
    console.log("[useConversationState] syncWithNostr triggered");
    triggerDerivedPnsSync();
    triggerProcessStored1081Events();
  }, [triggerDerivedPnsSync, triggerProcessStored1081Events]);

  // Migrate existing conversations when PNS keys are available
  useEffect(() => {
    if (
      currentPnsKeys &&
      conversationsLoaded &&
      !migrationAttemptedRef.current
    ) {
      const storedConversations = loadConversationsFromStorage();
      const hasUnsyncedMessages = storedConversations.some((c) =>
        c.messages.some((m) => !m._eventId)
      );

      if (hasUnsyncedMessages) {
        migrationAttemptedRef.current = true;
        console.log("Found unsynced messages, starting migration...");
        const updatedConversations = migrateConversations(
          storedConversations,
          currentPnsKeys
        );

        if (updatedConversations) {
          // Update map and state with migrated conversations (containing event IDs)
          updatedConversations.forEach((c) => {
            conversationsMapRef.current.set(c.id, c);
          });
          setConversations(updatedConversations);
          clearAllConversations();
        }
      }
    }
  }, [currentPnsKeys, conversationsLoaded, migrateConversations]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  // Process synced events from useChatSyncProMax
  useEffect(() => {
    if (!currentPnsKeys) {
      return;
    }

    let hasNewEvents = false;
    let failedDecryptions = 0;
    let successfulDecryptions = 0;

    const eventsToLoad = eventStore.getByFilters({ kinds: [1080] });
    eventsToLoad.forEach((event) => {
      // Skip already processed events
      if (processedEventIdsRef.current.has(event.id)) {
        return;
      }

      // Decrypt and process the event
      const innerEvent = decryptPnsEventToInner(event, currentPnsKeys);
      if (!innerEvent) {
        failedDecryptions++;
        // Still mark as processed to avoid repeated decryption attempts
        processedEventIdsRef.current.add(event.id);
        return;
      }

      // Update conversations map
      processInnerEvent(conversationsMapRef.current, innerEvent);
      processedEventIdsRef.current.add(event.id);
      hasNewEvents = true;
      successfulDecryptions++;
    });

    // Log decryption statistics for debugging
    if (failedDecryptions > 0 || successfulDecryptions > 0) {
      console.log(
        `[useConversationState] PNS event decryption stats: ${successfulDecryptions} successful, ${failedDecryptions} failed`
      );
    }

    // Update state with new conversations array if we processed any new events
    if (hasNewEvents) {
      const updatedConversations = Array.from(
        conversationsMapRef.current.values()
      );
      const sortedConversations =
        sortConversationsByRecentActivity(updatedConversations);
      setConversations(sortedConversations);

      // Update messages for active conversation
      const currentActiveId = activeConversationIdRef.current;
      if (currentActiveId) {
        const activeConv = conversationsMapRef.current.get(currentActiveId);
        if (activeConv) {
          // Load satsSpent from localStorage and merge with messages
          const storedSatsSpent = loadSatsSpentMap();

          console.log("settings messages agian, a", activeConv.messages);
          setMessages((prevMessages) => {
            // Also collect satsSpent from current messages (in case they weren't saved yet)
            const satsSpentMap = new Map<string, number>();
            prevMessages.forEach((msg) => {
              if (msg._eventId && msg.satsSpent !== undefined) {
                satsSpentMap.set(msg._eventId, msg.satsSpent);
              }
            });

            // Merge satsSpent into the new messages (prioritize localStorage, then current state)
            return activeConv.messages.map((msg) => {
              if (msg._eventId) {
                // First check localStorage
                if (storedSatsSpent[msg._eventId] !== undefined) {
                  return { ...msg, satsSpent: storedSatsSpent[msg._eventId] };
                }
                // Then check current state
                if (satsSpentMap.has(msg._eventId)) {
                  return { ...msg, satsSpent: satsSpentMap.get(msg._eventId) };
                }
              }
              return msg;
            });
          });
        }
      }
    }
    setConversationsLoaded(true);
  }, [syncedEvents, currentPnsKeys, loading1081]);

  // Set editing content when editing message index changes
  useEffect(() => {
    if (editingMessageIndex !== null && messages[editingMessageIndex]) {
      const messageText = getTextFromContent(
        messages[editingMessageIndex].content
      );
      setEditingContent(messageText);
    }
  }, [editingMessageIndex, messages]);

  // Reset inline editing state when switching conversations
  useEffect(() => {
    setEditingMessageIndex(null);
    setEditingContent("");
  }, [activeConversationId]);

  // Wrapper function to set active conversation ID and save to localStorage
  const setActiveConversationIdWithStorage = useCallback(
    (conversationId: string | null) => {
      setActiveConversationId(conversationId);
      saveActiveConversationId(conversationId);
    },
    []
  );

  // Used when the "New Chat" button is clicked - clears the active conversation
  // The actual conversation is only created when the AI starts responding
  const startNewConversation = useCallback(() => {
    setActiveConversationIdWithStorage(null);
    setMessages([]);
  }, [setActiveConversationIdWithStorage]);

  // Creates an actual conversation - called when AI response starts
  const createNewConversationHandler = useCallback(
    (initialMessages: Message[] = [], timestamp?: string) => {
      let createdId: string = "";
      setConversations((prevConversations) => {
        const { newConversation, updatedConversations } =
          createNewConversationWithMap(
            conversationsMapRef.current,
            initialMessages,
            timestamp
          );
        createdId = newConversation.id;
        setActiveConversationIdWithStorage(newConversation.id);
        // Set messages to the initial messages (empty array if none provided)
        setMessages(newConversation.messages);
        return updatedConversations;
      });
      return createdId;
    },
    [setActiveConversationIdWithStorage]
  );

  const loadConversation = useCallback(
    (conversationId: string) => {
      setConversations((prevConversations) => {
        const conversation = conversationsMapRef.current.get(conversationId);
        if (conversation) {
          setActiveConversationIdWithStorage(conversationId);
          console.log("rdlogs: loadConversation", conversationId, conversation);

          // Apply satsSpent from localStorage when loading
          const storedSatsSpent = loadSatsSpentMap();
          const messagesWithSatsSpent = conversation.messages.map((msg) => {
            if (msg._eventId && storedSatsSpent[msg._eventId] !== undefined) {
              return { ...msg, satsSpent: storedSatsSpent[msg._eventId] };
            }
            return msg;
          });
          setMessages(messagesWithSatsSpent);
        }
        return prevConversations;
      });
    },
    [setActiveConversationIdWithStorage]
  );

  // Internal function to delete a conversation by ID (no event required)
  const deleteConversationById = useCallback(
    (conversationId: string) => {
      setConversations((prevConversations) => {
        const updatedConversations = deleteConversationFromStorage(
          prevConversations,
          conversationId
        );

        // Get the conversation to access its messages and their event IDs
        const conversation = conversationsMapRef.current.get(conversationId);
        if (conversation && currentPnsKeys) {
          // Collect all event IDs from messages that have _eventId
          const eventIds: string[] = [];
          conversation.messages.forEach((message) => {
            if (message._eventId) {
              eventIds.push(message._eventId);
            }
          });

          // If we have events to delete, create deletion events and remove them
          if (eventIds.length > 0) {
            try {
              // Create PNS deletion event
              const deletionEvent = createPnsDeletionEvent(
                eventIds,
                currentPnsKeys,
                "Conversation deleted"
              );

              // Add the deletion event to the store
              eventStore.add(deletionEvent);

              // Remove all the events by their IDs
              for (const eventId of eventIds) {
                eventStore.remove(eventId);
              }

              // Sync the deletion event to relays
              performDeletionSync(deletionEvent);

              console.log(
                `[useConversationState] Deleted ${eventIds.length} events for conversation ${conversationId}`
              );
            } catch (error) {
              console.error(
                "[useConversationState] Failed to create deletion event:",
                error
              );
            }
          }
        }

        // Also delete from conversationsMapRef
        conversationsMapRef.current.delete(conversationId);

        if (conversationId === activeConversationIdRef.current) {
          setActiveConversationIdWithStorage(null);
          setMessages([]);
        }

        return updatedConversations;
      });
    },
    [setActiveConversationIdWithStorage, currentPnsKeys, performDeletionSync]
  );

  const deleteConversation = useCallback(
    async (conversationId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      deleteConversationById(conversationId);
    },
    [deleteConversationById]
  );

  // Auto-delete old conversations (older than 7 days) when enabled
  useEffect(() => {
    if (!conversationsLoaded || autoDeleteAttemptedRef.current) {
      return;
    }

    const autoDeleteEnabled = loadAutoDeleteConversations();
    if (!autoDeleteEnabled) {
      return;
    }

    autoDeleteAttemptedRef.current = true;

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const idsToDelete: string[] = [];

    conversations.forEach((conversation) => {
      if (conversation.messages.length > 0) {
        const lastMessage =
          conversation.messages[conversation.messages.length - 1];
        if (lastMessage._createdAt) {
          // _createdAt is in seconds, convert to ms
          const messageTime = lastMessage._createdAt * 1000;
          if (now - messageTime > sevenDaysMs) {
            idsToDelete.push(conversation.id);
          }
        }
      }
    });

    if (idsToDelete.length > 0) {
      console.log(
        `[useConversationState] Auto-deleting ${idsToDelete.length} old conversations`
      );
      // Use setTimeout to avoid state updates during render
      setTimeout(() => {
        idsToDelete.forEach((id) => {
          deleteConversationById(id);
        });
      }, 0);
    }
  }, [conversationsLoaded, conversations, deleteConversationById]);

  const clearConversations = useCallback(() => {
    setConversations([]);
    setActiveConversationIdWithStorage(null);
    setMessages([]);
    clearAllConversations();
    // Also clear the conversationsMapRef
    conversationsMapRef.current.clear();
  }, [setActiveConversationIdWithStorage]);

  const startEditingMessage = useCallback(
    (index: number) => {
      setEditingMessageIndex(index);
      const messageText = getTextFromContent(messages[index].content);
      setEditingContent(messageText);
      // Store the original message content for preserving attachments
      if (typeof messages[index].content !== "string") {
        // Already an array with possible attachments
      }
    },
    [messages]
  );

  const cancelEditing = useCallback(() => {
    setEditingMessageIndex(null);
    setEditingContent("");
  }, []);

  const appendMessageToConversation = useCallback(
    (conversationId: string, message: Message) => {
      // Get or create conversation in map
      let conversation = conversationsMapRef.current.get(conversationId);

      if (!conversation) {
        // Create new conversation if it doesn't exist
        conversation = {
          id: conversationId,
          title: "New Conversation",
          messages: [],
        };
        conversationsMapRef.current.set(conversationId, conversation);
      }

      // Append message to conversation
      conversation.messages.push(message);

      // Update state with new conversation array
      const updatedConversations = Array.from(
        conversationsMapRef.current.values()
      );
      const sortedConversations =
        sortConversationsByRecentActivity(updatedConversations);
      setConversations(sortedConversations);

      // Update messages if this is the active conversation
      const activeConversationId = loadActiveConversationId();

      if (activeConversationId === conversationId) {
        console.log(activeConversationId, conversationId);
        setMessages([...conversation.messages]);
      }
    },
    []
  );

  const createAndStoreChatEvent = useCallback(
    async (
      conversationId: string,
      message: Message
    ): Promise<string | null> => {
      console.log("Createing mes 1081", message);
      const strippedMessage = stripImageDataFromSingleMessage(message);
      if (currentPnsKeys) {
        return publishMessage(
          conversationId,
          strippedMessage,
          currentPnsKeys,
          appendMessageToConversation
        );
      } else {
        console.log(
          "[useConversationState] No currentPnsKeys, triggering stored 1081 events processing"
        );
        triggerProcessStored1081Events();

        // Wait for keys to be derived
        try {
          const keys = await firstValueFrom(
            derivedPnsKeys$.pipe(
              map((keysMap) => {
                // Find the first PNS keys with SALT_PNS
                return Array.from(keysMap.values()).find(
                  (pnsKeys) => pnsKeys.salt === SALT_PNS
                );
              }),
              filter((keys) => !!keys),
              timeout(5000) // Timeout after 5 seconds
            )
          );

          if (keys) {
            return publishMessage(
              conversationId,
              strippedMessage,
              keys,
              appendMessageToConversation
            );
          }
        } catch (err) {
          console.error("Failed to derive keys in time", err);
          return null;
        }
      }
      return null;
    },
    [
      publishMessage,
      currentPnsKeys,
      appendMessageToConversation,
      triggerProcessStored1081Events,
    ]
  );

  const getLastNonSystemMessageEventId = useCallback(
    (conversationId: string, lastMessageRole?: string[]): string => {
      // Create a string of 64 zeros (empty Nostr event ID)
      const emptyEventId = "0".repeat(64);

      // Get the conversation from the ref map
      const conversation = conversationsMapRef.current.get(conversationId);
      if (!conversation || conversation.messages.length === 0) {
        return emptyEventId;
      }

      // Iterate backwards to find the last message of the specified type
      for (let i = conversation.messages.length - 1; i >= 0; i--) {
        const message = conversation.messages[i];

        if (lastMessageRole !== undefined && lastMessageRole.length > 0) {
          // If lastMessageRole is specified, only consider messages of that type
          if (lastMessageRole.includes(message.role)) {
            return message._eventId || emptyEventId;
          }
        } else {
          // If no type specified, find last non-system message
          return message._eventId || emptyEventId;
        }
      }

      // If no non-system messages found, return empty Nostr event
      return emptyEventId;
    },
    []
  );

  const updateLastMessageSatsSpent = useCallback(
    (conversationId: string, satsSpent: number) => {
      // Get the conversation from the ref map
      const conversation = conversationsMapRef.current.get(conversationId);
      if (!conversation || conversation.messages.length === 0) {
        console.log("No conversation or messages found");
        return;
      }

      // Update the last message with satsSpent
      const lastMessage =
        conversation.messages[conversation.messages.length - 1];

      if (lastMessage && lastMessage.role === "assistant") {
        const updatedMessage = { ...lastMessage, satsSpent };
        conversation.messages[conversation.messages.length - 1] =
          updatedMessage;

        // Save to localStorage so it persists across syncs
        if (lastMessage._eventId) {
          saveSatsSpent(lastMessage._eventId, satsSpent);
        }

        // Update state if this is the active conversation
        const activeConversationId = loadActiveConversationId();
        console.log(
          activeConversationIdRef.current,
          activeConversationId,
          conversationId
        );
        if (activeConversationId === conversationId) {
          console.log("latest messaegs with sats spend", conversation.messages);
          // Create new message objects to ensure React detects the change
          setMessages(conversation.messages.map((msg) => ({ ...msg })));
        }

        // Update conversations state to trigger re-render
        const updatedConversations = Array.from(
          conversationsMapRef.current.values()
        );
        const sortedConversations =
          sortConversationsByRecentActivity(updatedConversations);
        setConversations(sortedConversations);
      }
    },
    []
  );

  return {
    conversations,
    activeConversationId,
    messages,
    editingMessageIndex,
    editingContent,
    setConversations,
    setActiveConversationId: setActiveConversationIdWithStorage,
    setMessages,
    setEditingMessageIndex,
    setEditingContent,
    createNewConversationHandler,
    startNewConversation,
    loadConversation,
    deleteConversation,
    clearConversations,
    startEditingMessage,
    cancelEditing,
    saveConversationById: (conversationId: string, newMessages: Message[]) => {
      setConversations((prevConversations) => {
        return saveConversationToStorage(
          prevConversations,
          conversationId,
          newMessages
        );
      });
    },
    appendMessageToConversation,
    getActiveConversationId: () => loadActiveConversationId(),
    getLastNonSystemMessageEventId,
    updateLastMessageSatsSpent,
    conversationsLoaded,
    isSyncing,
    currentPns: currentPnsKeys,
    createAndStoreChatEvent,
    syncWithNostr,
  };
};
