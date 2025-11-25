import { Conversation } from '@/types/chat';
import { persistConversationsSnapshot } from './conversationUtils';

/**
 * Manages batched updates to localStorage to prevent thrashing
 * Debounces multiple rapid updates into a single write operation
 */
export class StorageBatchManager {
  private pendingUpdates: Map<string, Conversation>;
  private debounceTimer: NodeJS.Timeout | null;
  private readonly debounceDelay: number;
  private allConversations: Map<string, Conversation>;

  constructor(debounceDelay: number = 500) {
    this.pendingUpdates = new Map();
    this.debounceTimer = null;
    this.debounceDelay = debounceDelay;
    this.allConversations = new Map();
  }

  /**
   * Queue a conversation for storage update
   * @param conversation The conversation to update
   */
  queueUpdate(conversation: Conversation): void {
    // Add to pending updates
    this.pendingUpdates.set(conversation.id, conversation);
    
    // Also update the in-memory snapshot
    this.allConversations.set(conversation.id, conversation);

    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new debounced timer
    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.debounceDelay);
  }

  /**
   * Queue multiple conversations for storage update
   * @param conversations Array of conversations to update
   */
  queueBatchUpdate(conversations: Conversation[]): void {
    conversations.forEach((conv) => {
      this.pendingUpdates.set(conv.id, conv);
      this.allConversations.set(conv.id, conv);
    });

    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new debounced timer
    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.debounceDelay);
  }

  /**
   * Immediately flush all pending updates to localStorage
   */
  flush(): void {
    if (this.pendingUpdates.size === 0) {
      return;
    }

    try {
      // Get all conversations (pending updates merged with existing)
      const allConversations = Array.from(this.allConversations.values());

      // Sort by ID for consistent ordering
      allConversations.sort((a, b) => {
        // Try to parse as numbers first (timestamps)
        const aNum = parseInt(a.id);
        const bNum = parseInt(b.id);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return bNum - aNum; // Descending order (newest first)
        }
        // Fall back to string comparison
        return b.id.localeCompare(a.id);
      });

      // Persist to localStorage
      console.log('Persisting conversations to storage:', allConversations);
      persistConversationsSnapshot(allConversations);

      // Clear pending updates
      this.pendingUpdates.clear();

      // Clear timer
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
    } catch (error) {
      console.error('Error flushing storage updates:', error);
    }
  }

  /**
   * Clear all pending updates without flushing
   */
  clear(): void {
    this.pendingUpdates.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Initialize the manager with existing conversations
   * @param conversations Initial conversations to track
   */
  initialize(conversations: Conversation[]): void {
    this.allConversations.clear();
    conversations.forEach((conv) => {
      this.allConversations.set(conv.id, conv);
    });
  }

  /**
   * Get a conversation from the in-memory snapshot
   * @param conversationId The conversation ID
   * @returns The conversation or undefined
   */
  getConversation(conversationId: string): Conversation | undefined {
    return this.allConversations.get(conversationId);
  }

  /**
   * Get all conversations from the in-memory snapshot
   * @returns Array of all conversations
   */
  getAllConversations(): Conversation[] {
    return Array.from(this.allConversations.values());
  }

  /**
   * Remove a conversation from tracking
   * @param conversationId The conversation ID to remove
   */
  removeConversation(conversationId: string): void {
    this.allConversations.delete(conversationId);
    this.pendingUpdates.delete(conversationId);
    // Queue a flush to persist the deletion
    this.queueUpdate = this.queueUpdate.bind(this);
    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => {
        this.flush();
      }, this.debounceDelay);
    }
  }

  /**
   * Check if there are pending updates
   * @returns True if there are pending updates
   */
  hasPendingUpdates(): boolean {
    return this.pendingUpdates.size > 0;
  }

  /**
   * Get the number of pending updates
   * @returns Count of pending updates
   */
  getPendingCount(): number {
    return this.pendingUpdates.size;
  }
}

// Global singleton instance for use across the app
let globalStorageManager: StorageBatchManager | null = null;

/**
 * Get or create the global storage manager instance
 * @param debounceDelay Optional custom debounce delay
 * @returns The global storage manager instance
 */
export function getStorageManager(debounceDelay?: number): StorageBatchManager {
  if (!globalStorageManager) {
    globalStorageManager = new StorageBatchManager(debounceDelay);
  }
  return globalStorageManager;
}

/**
 * Reset the global storage manager (useful for testing)
 */
export function resetStorageManager(): void {
  if (globalStorageManager) {
    globalStorageManager.flush();
    globalStorageManager.clear();
  }
  globalStorageManager = null;
}