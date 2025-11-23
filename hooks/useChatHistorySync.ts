import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Conversation, Message } from '@/types/chat';
import { useNostr } from '@/hooks/useNostr';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { KINDS } from '@/lib/nostr-kinds';
import {
  getConversationsUpdatedAt,
  loadConversationsFromStorage,
  persistConversationsSnapshot
} from '@/utils/conversationUtils';
import { EventFactory } from 'applesauce-factory';
import { relayPool } from '@/lib/applesauce-core';
import { loadRelays } from '@/utils/storageUtils';
import type { NostrEvent } from 'nostr-tools';

interface ChunkDescriptor {
  id: string;
  index: number;
  size?: number;
}

interface ChatHistoryEnvelope {
  version: number;
  updatedAt: number;
  conversations?: Conversation[];
  chunks?: ChunkDescriptor[];
}

interface UseChatHistorySyncParams {
  conversations: Conversation[];
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  activeConversationId: string | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  conversationsLoaded: boolean;
}

const CHAT_HISTORY_D_TAG = 'routstr-chat-history-v1';
const PUBLISH_DEBOUNCE_MS = 1000;
const MAX_NIP44_PLAINTEXT_BYTES = 65535;

const buildChunkDTag = (chunkId: string): string => `${CHAT_HISTORY_D_TAG}::chunk::${chunkId}`;

const generateChunkId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch (error) {
    // Ignore and fall back to pseudo-random string
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const splitIntoUtf8Chunks = (input: string, maxBytes: number): string[] => {
  if (!input) return [''];

  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.length <= maxBytes) {
    return [input];
  }

  const chunks: string[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    let end = Math.min(bytes.length, offset + maxBytes);
    let decodedChunk: string | null = null;

    while (end > offset) {
      const slice = bytes.slice(offset, end);
      try {
        decodedChunk = new TextDecoder('utf-8', { fatal: true }).decode(slice);
        break;
      } catch {
        end -= 1;
      }
    }

    if (decodedChunk === null) {
      throw new Error('Unable to chunk chat history within NIP-44 plaintext limits');
    }

    chunks.push(decodedChunk);
    offset = end;
  }

  return chunks;
};

const parseChatHistoryEnvelope = (
  payload: string,
  fallbackUpdatedAt: number
): ChatHistoryEnvelope => {
  try {
    const data = JSON.parse(payload);

    if (Array.isArray(data)) {
      return {
        version: 1,
        updatedAt: fallbackUpdatedAt,
        conversations: data as Conversation[]
      };
    }

    if (data && typeof data === 'object') {
      const typed = data as ChatHistoryEnvelope;
      const conversations = Array.isArray(typed.conversations) ? typed.conversations : undefined;
      const chunks = Array.isArray(typed.chunks)
        ? typed.chunks
            .map(chunk => {
              if (!chunk || typeof chunk !== 'object') return null;
              if (typeof chunk.id !== 'string') return null;
              if (typeof chunk.index !== 'number') return null;
              const descriptor: ChunkDescriptor = {
                id: chunk.id,
                index: chunk.index
              };
              if (typeof chunk.size === 'number') {
                descriptor.size = chunk.size;
              }
              return descriptor;
            })
            .filter((chunk): chunk is ChunkDescriptor => chunk !== null)
        : undefined;

      const updatedAt = typeof typed.updatedAt === 'number' ? typed.updatedAt : fallbackUpdatedAt;

      return {
        version: typeof typed.version === 'number' ? typed.version : 1,
        updatedAt,
        conversations,
        chunks
      };
    }
  } catch (error) {
    console.error('Failed to parse chat history envelope:', error);
  }

  return {
    version: 1,
    updatedAt: fallbackUpdatedAt,
    conversations: []
  };
};

/**
 * Handles syncing chat history with Nostr using NIP-44 encryption (kind 30078)
 */
export const useChatHistorySync = ({
  conversations,
  setConversations,
  activeConversationId,
  setMessages,
  conversationsLoaded
}: UseChatHistorySyncParams): void => {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const lastSyncedAtRef = useRef<number>(0);
  const hasLoadedFromCloudRef = useRef<boolean>(false);
  const pendingPublishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getLocalUpdatedAt = useCallback(() => getConversationsUpdatedAt(), []);

  // Initialize last synced timestamp from local storage
  useEffect(() => {
    lastSyncedAtRef.current = getLocalUpdatedAt();
  }, [getLocalUpdatedAt]);

  const publishSnapshot = useCallback(async (targetUpdatedAt: number) => {
    if (!user) return;
    if (!user.signer?.nip44) return;

    try {
      // Create EventFactory with the user's signer
      const factory = new EventFactory({ signer: user.signer });
      const relays = loadRelays();
      
      if (relays.length === 0) {
        console.warn('No relays configured; skipping cloud sync.');
        return;
      }

      const snapshot = loadConversationsFromStorage();
      const snapshotJson = JSON.stringify(snapshot);
      const encodedBytes = new TextEncoder().encode(snapshotJson);

      if (encodedBytes.length <= MAX_NIP44_PLAINTEXT_BYTES) {
        const nip44 = user.signer.nip44;
        if (!nip44) {
          console.warn('NIP-44 signer missing during chat history publish; skipping cloud sync.');
          return;
        }

        const envelope: ChatHistoryEnvelope = {
          version: 1,
          updatedAt: targetUpdatedAt,
          conversations: snapshot
        };

        const encrypted = await nip44.encrypt(
          user.pubkey,
          JSON.stringify(envelope)
        );

        const eventTemplate: NostrEvent = {
          kind: KINDS.ARBITRARY_APP_DATA,
          content: encrypted,
          tags: [['d', CHAT_HISTORY_D_TAG]],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: user.pubkey
        } as NostrEvent;

        const signedEvent = await factory.sign(eventTemplate);
        await relayPool.publish(relays, signedEvent);
        lastSyncedAtRef.current = targetUpdatedAt;
        return;
      }

      const nip44 = user.signer.nip44;
      if (!nip44) {
        console.warn('NIP-44 signer missing during chat history chunk publish; skipping cloud sync.');
        return;
      }

      const chunks = splitIntoUtf8Chunks(snapshotJson, MAX_NIP44_PLAINTEXT_BYTES);
      const chunkDescriptors: ChunkDescriptor[] = [];

      for (let index = 0; index < chunks.length; index += 1) {
        const chunkId = generateChunkId();
        const chunkContent = chunks[index];
        const encryptedChunk = await nip44.encrypt(user.pubkey, chunkContent);

        const chunkEventTemplate: NostrEvent = {
          kind: KINDS.ARBITRARY_APP_DATA,
          content: encryptedChunk,
          tags: [
            ['d', buildChunkDTag(chunkId)],
            ['parent', CHAT_HISTORY_D_TAG],
            ['i', index.toString()]
          ],
          created_at: Math.floor(Date.now() / 1000),
          pubkey: user.pubkey
        } as NostrEvent;

        const signedChunkEvent = await factory.sign(chunkEventTemplate);
        await relayPool.publish(relays, signedChunkEvent);
        chunkDescriptors.push({ id: chunkId, index, size: chunkContent.length });
      }

      const envelope: ChatHistoryEnvelope = {
        version: 1,
        updatedAt: targetUpdatedAt,
        chunks: chunkDescriptors
      };

      const encryptedEnvelope = await nip44.encrypt(
        user.pubkey,
        JSON.stringify(envelope)
      );

      const envelopeEventTemplate: NostrEvent = {
        kind: KINDS.ARBITRARY_APP_DATA,
        content: encryptedEnvelope,
        tags: [['d', CHAT_HISTORY_D_TAG]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: user.pubkey
      } as NostrEvent;

      const signedEnvelopeEvent = await factory.sign(envelopeEventTemplate);
      await relayPool.publish(relays, signedEnvelopeEvent);
      lastSyncedAtRef.current = targetUpdatedAt;
    } catch (error) {
      console.error('Failed to sync chat history to Nostr:', error);
    }
  }, [user]);

  const schedulePublish = useCallback((updatedAt: number) => {
    if (!user) return;
    if (!user.signer?.nip44) return;

    if (pendingPublishTimeoutRef.current) {
      clearTimeout(pendingPublishTimeoutRef.current);
    }

    pendingPublishTimeoutRef.current = setTimeout(() => {
      pendingPublishTimeoutRef.current = null;
      publishSnapshot(updatedAt);
    }, PUBLISH_DEBOUNCE_MS);
  }, [publishSnapshot, user]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pendingPublishTimeoutRef.current) {
        clearTimeout(pendingPublishTimeoutRef.current);
        pendingPublishTimeoutRef.current = null;
      }
    };
  }, []);

  // Reset sync state when the active user changes
  useEffect(() => {
    if (pendingPublishTimeoutRef.current) {
      clearTimeout(pendingPublishTimeoutRef.current);
      pendingPublishTimeoutRef.current = null;
    }
    hasLoadedFromCloudRef.current = false;
    lastSyncedAtRef.current = getLocalUpdatedAt();
  }, [getLocalUpdatedAt, user?.pubkey]);

  // Load existing chat history from Nostr once when ready
  useEffect(() => {
    if (!conversationsLoaded) return;
    if (!nostr || !user) return;
    if (!user.signer?.nip44) {
      console.warn('NIP-44 encryption not supported by the active signer; chat history will remain local only.');
      return;
    }
    if (hasLoadedFromCloudRef.current) return;

    const controller = new AbortController();

    const fetchCloudHistory = async () => {
      console.log("FETCHING CLOUD CONVOS");
      try {
        const filter = {
          kinds: [KINDS.ARBITRARY_APP_DATA],
          authors: [user.pubkey],
          '#d': [CHAT_HISTORY_D_TAG],
          limit: 1
        };

        const events = await nostr.query([filter], { signal: controller.signal });
        const localUpdatedAt = getLocalUpdatedAt();

        if (!events || events.length === 0) {
          hasLoadedFromCloudRef.current = true;
          if (localUpdatedAt > 0) {
            schedulePublish(localUpdatedAt);
          }
          return;
        }

        const latestEvent = [...events].sort((a, b) => b.created_at - a.created_at)[0];
        const fallbackUpdatedAt = (latestEvent.created_at || Math.floor(Date.now() / 1000)) * 1000;
        const nip44 = user.signer.nip44;
        if (!nip44) {
          console.warn('NIP-44 signer missing during chat history fetch; skipping cloud sync.');
          hasLoadedFromCloudRef.current = true;
          return;
        }

        const decrypted = await nip44.decrypt(user.pubkey, latestEvent.content);
        const {
          conversations: directConversations,
          updatedAt: cloudUpdatedAt,
          chunks
        } = parseChatHistoryEnvelope(decrypted, fallbackUpdatedAt);

        let cloudConversations = directConversations;

        if ((!cloudConversations || cloudConversations.length === 0) && chunks && chunks.length > 0) {
          const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);
          const filters = sortedChunks.map(chunk => ({
            kinds: [KINDS.ARBITRARY_APP_DATA],
            authors: [user.pubkey],
            '#d': [buildChunkDTag(chunk.id)],
            limit: 1
          }));

          const chunkEvents = await nostr.query(filters, { signal: controller.signal });
          console.log(chunkEvents)
          const eventsByDTag = new Map<string, typeof chunkEvents[number]>();

          chunkEvents.forEach(event => {
            const dTag = event.tags.find(tag => tag[0] === 'd');
            if (dTag && dTag[1]) {
              eventsByDTag.set(dTag[1], event);
            }
          });

          const reconstructedParts: string[] = [];
          let chunkFailure = false;

          for (const chunk of sortedChunks) {
            const dTag = buildChunkDTag(chunk.id);
            const chunkEvent = eventsByDTag.get(dTag);
            if (!chunkEvent) {
              console.warn('Missing chunk event for chat history sync:', dTag);
              chunkFailure = true;
              continue;
            }

            try {
              const decryptedChunk = await nip44.decrypt(user.pubkey, chunkEvent.content);
              reconstructedParts.push(decryptedChunk);
            } catch (error) {
              console.error('Failed to decrypt chat history chunk:', error);
              chunkFailure = true;
              break;
            }
          }

          if (!chunkFailure) {
            try {
              const combined = reconstructedParts.join('');
              const parsedConversations = JSON.parse(combined) as Conversation[];
              cloudConversations = parsedConversations;
            } catch (error) {
              console.error('Failed to parse reconstructed chat history snapshot:', error);
            }
          }
        }

        hasLoadedFromCloudRef.current = true;

        if (cloudConversations && cloudConversations.length > 0 && cloudUpdatedAt > localUpdatedAt) {
          persistConversationsSnapshot(cloudConversations, cloudUpdatedAt);
          setConversations(cloudConversations);

          if (activeConversationId) {
            const activeConversation = cloudConversations.find(convo => convo.id === activeConversationId);
            setMessages(activeConversation ? activeConversation.messages : []);
          }

          lastSyncedAtRef.current = cloudUpdatedAt;
        } else if (localUpdatedAt > cloudUpdatedAt && localUpdatedAt > 0) {
          schedulePublish(localUpdatedAt);
          lastSyncedAtRef.current = localUpdatedAt;
        } else {
          lastSyncedAtRef.current = Math.max(localUpdatedAt, cloudUpdatedAt);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Failed to load chat history from Nostr:', error);
        hasLoadedFromCloudRef.current = true;
      }
    };

    fetchCloudHistory();

    return () => {
      controller.abort();
    };
  }, [activeConversationId, conversationsLoaded, getLocalUpdatedAt, nostr, schedulePublish, setConversations, setMessages, user]);

  // Publish local updates to Nostr after initial sync
  useEffect(() => {
    if (!conversationsLoaded) return;
    if (!user) return;
    if (!user.signer?.nip44) return;
    if (!hasLoadedFromCloudRef.current) return;

    const localUpdatedAt = getLocalUpdatedAt();
    if (localUpdatedAt === 0) return;
    if (localUpdatedAt <= lastSyncedAtRef.current) return;

    schedulePublish(localUpdatedAt);
  }, [conversations, conversationsLoaded, getLocalUpdatedAt, schedulePublish, user]);
};
