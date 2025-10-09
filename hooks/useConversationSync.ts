import { useNostr } from '@/hooks/useNostr';
import { toast } from 'sonner';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KINDS } from '@/lib/nostr-kinds';
import { Conversation, Message } from '@/types/chat';
import { useState, useEffect, useCallback } from 'react';

export interface StoredConversation extends Conversation {
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageAt?: number;
}

interface ConversationStore {
  conversations: StoredConversation[];
  lastSync: number;
  version: string;
}

export function useConversationSync() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const [cloudSyncEnabled, setCloudSyncEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('conversation_cloud_sync_enabled') !== 'false';
    }
    return true;
  });

  const [lastSyncTime, setLastSyncTime] = useState<number | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('conversation_last_sync_time');
      return stored ? parseInt(stored) : null;
    }
    return null;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('conversation_cloud_sync_enabled', String(cloudSyncEnabled));
    }
  }, [cloudSyncEnabled]);

  useEffect(() => {
    if (typeof window !== 'undefined' && lastSyncTime) {
      localStorage.setItem('conversation_last_sync_time', String(lastSyncTime));
    }
  }, [lastSyncTime]);

  const CONVERSATIONS_D_TAG = 'routstr-chat-conversations-v1';
  const RETENTION_DAYS = 90;

  const getLocalConversations = useCallback((): StoredConversation[] => {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem('saved_conversations');
    if (!stored) return [];
    try {
      const conversations = JSON.parse(stored) as Conversation[];
      return conversations.map(conv => ({
        ...conv,
        createdAt: conv.createdAt || Date.now(),
        updatedAt: conv.updatedAt || Date.now(),
        messageCount: conv.messages.length,
        lastMessageAt: conv.messages.length > 0 ? Date.now() : undefined
      } as StoredConversation));
    } catch {
      return [];
    }
  }, []);

  const saveLocalConversations = useCallback((conversations: StoredConversation[]) => {
    if (typeof window === 'undefined') return;
    const simplified = conversations.map(conv => ({
      id: conv.id,
      title: conv.title,
      messages: conv.messages
    }));
    localStorage.setItem('saved_conversations', JSON.stringify(simplified));
  }, []);

  const syncConversationsMutation = useMutation({
    mutationFn: async (conversations: StoredConversation[]) => {
      if (!user) {
        throw new Error('User not logged in');
      }
      if (!user.signer.nip44) {
        throw new Error('NIP-44 encryption not supported by your signer');
      }

      const cutoffTime = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const relevantConversations = conversations
        .filter(conv => 
          conv.updatedAt > cutoffTime || conv.createdAt > cutoffTime
        )
        .map(conv => {
          if (conv.messages.length > 100) {
            return {
              ...conv,
              messages: conv.messages.slice(-100),
              messageCount: conv.messages.length,
              truncated: true
            };
          }
          return conv;
        });

      const store: ConversationStore = {
        conversations: relevantConversations,
        lastSync: Date.now(),
        version: '1.0.0'
      };

      const storeStr = JSON.stringify(store);
      const MAX_SIZE = 500000;
      
      if (storeStr.length > MAX_SIZE) {
        const chunks = Math.ceil(storeStr.length / MAX_SIZE);
        const events = [];
        
        for (let i = 0; i < chunks; i++) {
          const chunk = storeStr.slice(i * MAX_SIZE, (i + 1) * MAX_SIZE);
          const content = await user.signer.nip44.encrypt(user.pubkey, chunk);
          
          const event = await user.signer.signEvent({
            kind: KINDS.ARBITRARY_APP_DATA,
            content,
            tags: [
              ['d', `${CONVERSATIONS_D_TAG}-chunk-${i}`],
              ['chunk', `${i}`, `${chunks}`]
            ],
            created_at: Math.floor(Date.now() / 1000)
          });
          
          events.push(event);
          await nostr.event(event);
        }
        
        const indexEvent = await user.signer.signEvent({
          kind: KINDS.ARBITRARY_APP_DATA,
          content: await user.signer.nip44.encrypt(user.pubkey, JSON.stringify({ chunks, timestamp: Date.now() })),
          tags: [['d', CONVERSATIONS_D_TAG]],
          created_at: Math.floor(Date.now() / 1000)
        });
        
        await nostr.event(indexEvent);
        setLastSyncTime(Date.now());
        return indexEvent;
      }

      const content = await user.signer.nip44.encrypt(user.pubkey, storeStr);

      const event = await user.signer.signEvent({
        kind: KINDS.ARBITRARY_APP_DATA,
        content,
        tags: [['d', CONVERSATIONS_D_TAG]],
        created_at: Math.floor(Date.now() / 1000)
      });

      await nostr.event(event);
      setLastSyncTime(Date.now());
      return event;
    },
    onSuccess: () => {
      // Commented out to prevent infinite loops
      // queryClient.invalidateQueries({ queryKey: ['conversations', user?.pubkey, CONVERSATIONS_D_TAG] });
    }
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      if (!user) {
        throw new Error('User not logged in');
      }
      if (!user.signer.nip44) {
        throw new Error('NIP-44 encryption not supported by your signer');
      }

      const currentConversations = (queryClient.getQueryData(['conversations', user?.pubkey, CONVERSATIONS_D_TAG]) as StoredConversation[] | undefined) || [];
      const updatedConversations = currentConversations.filter(c => c.id !== conversationId);

      await syncConversationsMutation.mutateAsync(updatedConversations);
    },
    onSuccess: () => {
      // Commented out to prevent infinite loops
      // queryClient.invalidateQueries({ queryKey: ['conversations', user?.pubkey, CONVERSATIONS_D_TAG] });
    }
  });

  const conversationsQuery = useQuery({
    queryKey: ['conversations', user?.pubkey, CONVERSATIONS_D_TAG],
    queryFn: async ({ signal }) => {
      if (!user || !cloudSyncEnabled) {
        return getLocalConversations();
      }
      if (!user.signer.nip44) {
        return getLocalConversations();
      }

      try {
        const filter = {
          kinds: [KINDS.ARBITRARY_APP_DATA],
          authors: [user.pubkey],
          '#d': [CONVERSATIONS_D_TAG],
          limit: 1
        };

        const events = await nostr.query([filter], { signal });

        if (events.length === 0) {
          return getLocalConversations();
        }

        const latestEvent = events[0];
        const decrypted = await user.signer.nip44.decrypt(user.pubkey, latestEvent.content);
        
        let store: ConversationStore;
        
        try {
          const indexData = JSON.parse(decrypted);
          if (indexData.chunks && typeof indexData.chunks === 'number') {
            const chunkFilters = [];
            for (let i = 0; i < indexData.chunks; i++) {
              chunkFilters.push({
                kinds: [KINDS.ARBITRARY_APP_DATA],
                authors: [user.pubkey],
                '#d': [`${CONVERSATIONS_D_TAG}-chunk-${i}`],
                limit: 1
              });
            }
            
            const chunkEvents = await nostr.query(chunkFilters, { signal });
            const chunks: string[] = new Array(indexData.chunks);
            
            for (const event of chunkEvents) {
              const tag = event.tags.find(t => t[0] === 'chunk');
              if (tag) {
                const chunkIndex = parseInt(tag[1]);
                const decryptedChunk = await user.signer.nip44.decrypt(user.pubkey, event.content);
                chunks[chunkIndex] = decryptedChunk;
              }
            }
            
            const fullData = chunks.join('');
            store = JSON.parse(fullData);
          } else {
            store = JSON.parse(decrypted);
          }
        } catch {
          store = JSON.parse(decrypted);
        }
        
        const cloudConversations = store.conversations || [];

        const localConversations = getLocalConversations();
        const mergedMap = new Map<string, StoredConversation>();
        
        cloudConversations.forEach(conv => mergedMap.set(conv.id, conv));
        
        localConversations.forEach(conv => {
          const existing = mergedMap.get(conv.id);
          if (!existing || conv.updatedAt > existing.updatedAt) {
            mergedMap.set(conv.id, conv);
          }
        });

        const merged = Array.from(mergedMap.values());
        saveLocalConversations(merged);
        setLastSyncTime(Date.now());
        return merged;
      } catch (error) {
        if (error instanceof Error && error.message.includes('invalid MAC')) {
          toast.error('Nostr Extension: invalid MAC. Please switch to your previously connected account on the extension OR sign out and login.');
        }
        console.error('Failed to decrypt conversation data:', error);
        return getLocalConversations();
      }
    },
    enabled: !!user && cloudSyncEnabled,
    refetchInterval: false, // Disable auto-refetch to prevent infinite loops
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const createOrUpdateConversations = useCallback(
    (conversations: StoredConversation[]) => syncConversationsMutation.mutateAsync(conversations),
    [syncConversationsMutation]
  );

  const deleteConversation = useCallback(
    (conversationId: string) => deleteConversationMutation.mutateAsync(conversationId),
    [deleteConversationMutation]
  );

  const validateConversation = useCallback((conv: any): boolean => {
    if (!conv || typeof conv !== 'object') return false;
    if (!conv.id || typeof conv.id !== 'string') return false;
    if (!conv.title || typeof conv.title !== 'string') return false;
    if (!Array.isArray(conv.messages)) return false;
    
    for (const msg of conv.messages) {
      if (!msg || typeof msg !== 'object') return false;
      if (!msg.role || !['user', 'assistant', 'system'].includes(msg.role)) return false;
      if (!msg.content && msg.content !== '') return false;
    }
    
    return true;
  }, []);

  const addOrUpdateConversation = useCallback(async (conversation: Conversation) => {
    if (!validateConversation(conversation)) {
      console.error('Invalid conversation data:', conversation);
      return null;
    }

    const storedConv: StoredConversation = {
      ...conversation,
      createdAt: conversation.createdAt || Date.now(),
      updatedAt: Date.now(),
      messageCount: conversation.messages.length,
      lastMessageAt: conversation.messages.length > 0 ? Date.now() : undefined
    };

    const existing = getLocalConversations();
    const updated = existing.filter(c => c.id !== conversation.id);
    updated.push(storedConv);
    saveLocalConversations(updated);
    
    if (user && cloudSyncEnabled) {
      await syncConversationsMutation.mutateAsync(updated);
    }

    return storedConv;
  }, [getLocalConversations, saveLocalConversations, user, cloudSyncEnabled, syncConversationsMutation, validateConversation]);

  const cleanupOldConversations = useCallback(async () => {
    const conversations = getLocalConversations();
    const cutoffTime = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    const cleaned = conversations.filter(conv => 
      conv.updatedAt > cutoffTime || conv.createdAt > cutoffTime
    );
    
    if (cleaned.length !== conversations.length) {
      saveLocalConversations(cleaned);
      if (user && cloudSyncEnabled) {
        await syncConversationsMutation.mutateAsync(cleaned);
      }
    }
  }, [getLocalConversations, saveLocalConversations, user, cloudSyncEnabled, syncConversationsMutation]);

  const migrateToCloudSync = useCallback(async () => {
    if (!user || !cloudSyncEnabled) return;
    
    const localConversations = getLocalConversations();
    if (localConversations.length === 0) return;
    
    const hasCloudData = await nostr.query([{
      kinds: [KINDS.ARBITRARY_APP_DATA],
      authors: [user.pubkey],
      '#d': [CONVERSATIONS_D_TAG],
      limit: 1
    }]);
    
    if (hasCloudData.length === 0) {
      await syncConversationsMutation.mutateAsync(localConversations);
    }
  }, [user, cloudSyncEnabled, getLocalConversations, nostr, syncConversationsMutation]);

  const deduplicateConversations = useCallback(() => {
    const conversations = getLocalConversations();
    const seen = new Set<string>();
    const deduplicated: StoredConversation[] = [];
    
    conversations.forEach(conv => {
      if (!seen.has(conv.id)) {
        seen.add(conv.id);
        deduplicated.push(conv);
      } else {
        const existing = deduplicated.find(c => c.id === conv.id);
        if (existing && conv.updatedAt > existing.updatedAt) {
          const index = deduplicated.indexOf(existing);
          deduplicated[index] = conv;
        }
      }
    });
    
    if (deduplicated.length !== conversations.length) {
      saveLocalConversations(deduplicated);
    }
    
    return deduplicated;
  }, [getLocalConversations, saveLocalConversations]);

  const optimizeConversationSize = useCallback((conversation: StoredConversation): StoredConversation => {
    const optimizedMessages = conversation.messages.map(msg => {
      if (typeof msg.content === 'string') return msg;
      
      const optimizedContent = msg.content.map(item => {
        if (item.type === 'image' && item.image?.data && item.image.data.length > 100000) {
          return {
            ...item,
            image: {
              ...item.image,
              data: '[IMAGE_DATA_REMOVED_FOR_SYNC]'
            }
          };
        }
        return item;
      });
      
      return { ...msg, content: optimizedContent };
    });
    
    return { ...conversation, messages: optimizedMessages };
  }, []);

  const exportConversations = useCallback((): string => {
    const conversations = getLocalConversations();
    const exportData = {
      version: '1.0.0',
      exportedAt: Date.now(),
      conversations
    };
    return JSON.stringify(exportData, null, 2);
  }, [getLocalConversations]);

  const importConversations = useCallback((jsonData: string): { success: boolean; count: number; error?: string } => {
    try {
      const data = JSON.parse(jsonData);
      if (!data.conversations || !Array.isArray(data.conversations)) {
        return { success: false, count: 0, error: 'Invalid data format' };
      }
      
      const existingConversations = getLocalConversations();
      const existingIds = new Set(existingConversations.map(c => c.id));
      const imported: StoredConversation[] = [];
      
      data.conversations.forEach((conv: any) => {
        if (!validateConversation(conv)) return;
        
        const storedConv: StoredConversation = {
          id: conv.id,
          title: conv.title,
          messages: conv.messages,
          createdAt: conv.createdAt || Date.now(),
          updatedAt: conv.updatedAt || Date.now(),
          messageCount: conv.messages.length,
          lastMessageAt: conv.lastMessageAt
        };
        
        if (!existingIds.has(conv.id)) {
          imported.push(storedConv);
        }
      });
      
      if (imported.length > 0) {
        const merged = [...existingConversations, ...imported];
        saveLocalConversations(merged);
        
        if (user && cloudSyncEnabled) {
          syncConversationsMutation.mutateAsync(merged);
        }
      }
      
      return { success: true, count: imported.length };
    } catch (error) {
      return { success: false, count: 0, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [getLocalConversations, saveLocalConversations, validateConversation, user, cloudSyncEnabled, syncConversationsMutation]);

  const archiveConversation = useCallback((conversationId: string) => {
    const conversations = getLocalConversations();
    const conversation = conversations.find(c => c.id === conversationId);
    if (!conversation) return;
    
    const archivedKey = `archived_conversation_${conversationId}`;
    const archived = {
      ...conversation,
      archivedAt: Date.now()
    };
    
    if (typeof window !== 'undefined') {
      localStorage.setItem(archivedKey, JSON.stringify(archived));
    }
    
    const remaining = conversations.filter(c => c.id !== conversationId);
    saveLocalConversations(remaining);
  }, [getLocalConversations, saveLocalConversations]);

  const getArchivedConversations = useCallback((): StoredConversation[] => {
    if (typeof window === 'undefined') return [];
    
    const archived: StoredConversation[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('archived_conversation_')) {
        try {
          const data = localStorage.getItem(key);
          if (data) {
            archived.push(JSON.parse(data));
          }
        } catch {}
      }
    }
    
    return archived;
  }, []);

  // Removed auto-cleanup and auto-migration to prevent infinite loops
  // These should be called explicitly when needed

  return {
    syncedConversations: conversationsQuery.data || [],
    isLoadingConversations: conversationsQuery.isLoading,
    isSyncingConversations: syncConversationsMutation.isPending || deleteConversationMutation.isPending,
    createOrUpdateConversations,
    addOrUpdateConversation,
    deleteConversation,
    cleanupOldConversations,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    lastSyncTime,
    refetch: conversationsQuery.refetch,
    migrateToCloudSync,
    deduplicateConversations,
    optimizeConversationSize,
    exportConversations,
    importConversations,
    archiveConversation,
    getArchivedConversations
  };
}