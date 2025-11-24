# Incremental Chat Sync Architecture

## Overview

This document describes the refactored chat synchronization system that processes Nostr events incrementally, providing a better user experience by displaying messages as they arrive rather than waiting for all events to be fetched.

The system now supports **two modes of operation**:
1. **Batch Sync Mode** ([`useChatSync`](hooks/useChatSync.ts)) - Fetch all events at once or incrementally on demand
2. **Real-time Streaming Mode** ([`useChatSyncPro`](hooks/useChatSyncPro.ts)) - Live subscription with automatic conversation updates

## Key Components

### 1. Event Processing Utilities (`utils/eventProcessing.ts`)

Modular, reusable functions for processing Nostr events:

#### Core Functions

- **`decryptPnsEventToInner(pnsEvent, pnsKeys)`**
  - Decrypts a PNS event (Kind 1080) to an inner event (Kind 20001)
  - Returns `InnerEvent | null`

- **`extractConversationMetadata(innerEvent)`**
  - Extracts conversation ID, role, timestamps, and links from inner event
  - Returns `ConversationMetadata | null`

- **`innerEventToMessage(innerEvent)`**
  - Converts an inner event to a Message object
  - Handles JSON parsing and metadata attachment

- **`addMessageToConversation(conversation, message, options)`**
  - Adds a message to a conversation with deduplication
  - Sorts messages by timestamp if requested
  - Returns updated conversation

- **`shouldUpdateTitle(message, conversation)`**
  - Determines if a message should trigger title update
  - Returns true if message is earlier than current earliest

- **`generateTitleFromMessage(message, maxLength)`**
  - Generates a conversation title from message content
  - Handles both string and multimodal content

- **`updateConversationTitle(conversation, message)`**
  - Updates conversation title if message is the earliest
  - Only updates for the earliest message in the conversation

- **`processInnerEvent(conversationsMap, innerEvent)`**
  - High-level function that processes an inner event
  - Creates or updates conversations in the map
  - Handles title updates automatically

### 2. Storage Manager (`utils/storageManager.ts`)

Manages batched, debounced updates to localStorage to prevent thrashing:

#### StorageBatchManager Class

```typescript
class StorageBatchManager {
  // Queue a single conversation update
  queueUpdate(conversation: Conversation): void
  
  // Queue multiple conversations
  queueBatchUpdate(conversations: Conversation[]): void
  
  // Flush all pending updates immediately
  flush(): void
  
  // Clear pending updates without flushing
  clear(): void
  
  // Initialize with existing conversations
  initialize(conversations: Conversation[]): void
  
  // Get conversation from in-memory snapshot
  getConversation(conversationId: string): Conversation | undefined
  
  // Get all conversations
  getAllConversations(): Conversation[]
}
```

**Features:**
- Default 500ms debounce delay (configurable)
- Maintains in-memory snapshot of all conversations
- Automatically merges pending updates with existing data
- Global singleton pattern via `getStorageManager()`

### 3. Refactored Chat Sync Hook (`hooks/useChatSync.ts`)

#### New Functions

**`processPnsEventIncremental(pnsEvent, pnsKeys, conversationsMap, onConversationUpdate)`**
- Processes a single PNS event incrementally
- Decrypts, processes, and optionally triggers callback
- Used internally for incremental sync

**`syncConversationsIncremental(onConversationUpdate?, onComplete?)`**
- Main incremental sync function
- Processes events one by one
- Calls `onConversationUpdate` for each conversation as it's updated
- Calls `onComplete` with final array when done
- Queues batch storage update
- Returns: `Promise<Conversation[]>`

**`syncConversations()` (Backward Compatible)**
- Wrapper around `syncConversationsIncremental()`
- Maintains existing API for compatibility
- Returns: `Promise<Conversation[]>`

#### Return Interface

```typescript
interface ChatSyncHook {
  isSyncing: boolean;
  lastSyncTime: number | null;
  error: string | null;
  publishMessage: (...) => Promise<string | null>;
  syncConversations: () => Promise<Conversation[]>;
  syncConversationsIncremental: (
    onConversationUpdate?: (conv: Conversation) => void,
    onComplete?: (conversations: Conversation[]) => void
  ) => Promise<Conversation[]>;
}
```

### 4. Real-time Sync Hook (`hooks/useChatSyncPro.ts`)

Enhanced to process events and maintain conversations in real-time:

#### Key Features

- **Live Event Subscription**: Uses RxJS streams to subscribe to Nostr relays
- **Automatic Decryption**: Decrypts PNS events as they arrive
- **Real-time Conversation Updates**: Maintains conversations map and updates state
- **Batched Storage**: Uses storage manager for efficient persistence
- **Deduplication**: Prevents duplicate events from being processed

#### New State

```typescript
const [conversations, setConversations] = useState<Conversation[]>([])
const conversationsMapRef = useRef<Map<string, Conversation>>(new Map())
const pnsKeysRef = useRef<PnsKeys | null>(null)
```

#### Core Functions

**`getPnsKeys()`**
- Derives and caches PNS keys from login credentials
- Returns cached keys for efficiency
- Returns null if no login available

**`processEvent(event: NostrEvent)`**
- Decrypts PNS event to inner event
- Updates conversations map using [`processInnerEvent()`](utils/eventProcessing.ts:244)
- Updates state with sorted conversations
- Queues storage update

**Event Subscription**
- Subscribes to `kind1080Events$` RxJS stream
- Processes each event as it arrives
- Updates both raw events array and conversations
- Flushes storage on unmount

#### Return Interface

```typescript
{
  events: NostrEvent[];           // Raw PNS events
  conversations: Conversation[];  // Processed conversations
  loading: boolean;
  error: string | null;
}
```

### 5. Updated Conversation State Hook (`hooks/useConversationState.ts`)

#### New Functions

**`handleConversationUpdate(updatedConversation)`**
- Callback for incremental conversation updates
- Merges or adds conversations to state
- Called as each event is processed

**`syncWithNostr()` (Updated)**
- Now uses `syncConversationsIncremental()`
- Provides `handleConversationUpdate` callback
- Provides completion callback for logging
- Storage is handled automatically by storage manager

## Data Flow

### Real-time Streaming Flow (useChatSyncPro)

```
┌─────────────────────────────────────────┐
│ Nostr Relay Event Stream (RxJS)        │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│ Event arrives in subscription           │
└───────────────┬─────────────────────────┘
                │
                ├──────────────────────────┐
                ▼                          ▼
┌─────────────────────────┐  ┌────────────────────────┐
│ Update raw events array │  │ processEvent()          │
│ (with deduplication)    │  │ - Decrypt PNS event     │
└─────────────────────────┘  │ - Process inner event   │
                             │ - Update conversations  │
                             └──────────┬───────────────┘
                                        │
                             ┌──────────┴───────────┐
                             ▼                      ▼
                   ┌──────────────────┐  ┌──────────────────┐
                   │ Update UI State  │  │ Queue Storage    │
                   │ (immediate)      │  │ (debounced 500ms)│
                   └──────────────────┘  └──────────────────┘
```

### Incremental Sync Flow (useChatSync)

```
┌─────────────────────────────────────────┐
│ User triggers sync                      │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│ syncConversationsIncremental()          │
│ - Fetch all PNS events                  │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│ For each PNS event:                     │
│ ┌─────────────────────────────────────┐ │
│ │ 1. Decrypt to inner event           │ │
│ │ 2. Process inner event              │ │
│ │ 3. Update conversations map         │ │
│ │ 4. Check title update               │ │
│ │ 5. Call onConversationUpdate()      │ │
│ └─────────────────────────────────────┘ │
└───────────────┬─────────────────────────┘
                │
                ├──────────────┬─────────────────────┐
                ▼              ▼                     ▼
┌─────────────────────┐ ┌──────────────┐ ┌────────────────────┐
│ UI Update           │ │ Queue        │ │ Title Update       │
│ (immediate)         │ │ Storage      │ │ (if earliest msg)  │
│                     │ │ (debounced)  │ │                    │
└─────────────────────┘ └──────────────┘ └────────────────────┘
                                │
                                ▼
                        ┌──────────────┐
                        │ Batch Flush  │
                        │ (after 500ms)│
                        └──────────────┘
```

## Title Update Logic

### When Titles Are Updated

Titles are updated when a new message arrives that is **earlier** than the current earliest message in the conversation.

### Implementation

1. **Track earliest message**: Each conversation's messages are sorted by `_createdAt`
2. **Compare timestamps**: When a new message arrives, compare its timestamp with the earliest
3. **Update if earlier**: If the new message is earlier, generate a new title from it
4. **Active conversation only**: Currently optimized for active conversation updates

### Example

```typescript
// Initial state: Conversation has messages from 1000s onwards
conversation.messages[0]._createdAt = 1000

// New message arrives with earlier timestamp
newMessage._createdAt = 500

// shouldUpdateTitle() returns true
// Title is updated from newMessage content
conversation.title = generateTitleFromMessage(newMessage)
```

## Storage Strategy

### Immediate State Updates

- Conversations state is updated immediately as events are processed
- UI reflects changes in real-time

### Batched Storage Writes

- localStorage writes are debounced (500ms default)
- Multiple rapid updates are batched into single write
- Prevents localStorage thrashing
- Reduces performance impact

### Storage Manager Lifecycle

```typescript
// Initialize with existing conversations
const storageManager = getStorageManager();
storageManager.initialize(existingConversations);

// Queue updates as they arrive
storageManager.queueUpdate(updatedConversation);

// Or queue batch
storageManager.queueBatchUpdate(conversations);

// Automatic flush after debounce delay
// Or manual flush
storageManager.flush();
```

## Benefits

### User Experience
✅ Messages appear as they arrive (not all at once)
✅ Faster perceived load time
✅ Real-time sync feel
✅ Progress feedback during sync

### Performance
✅ Lower memory usage (process one at a time)
✅ Batched storage writes prevent thrashing
✅ Incremental rendering reduces UI lag
✅ Debouncing reduces I/O operations

### Maintainability
✅ Modular, testable functions
✅ Clear separation of concerns
✅ Reusable components
✅ Type-safe implementation

### Compatibility
✅ Backward compatible wrapper
✅ Gradual migration path
✅ Works with existing code
✅ Optional incremental mode

## Usage Examples

### Basic Sync (Backward Compatible)

```typescript
const { syncConversations, isSyncing } = useChatSync(relays);

// Old way still works
const conversations = await syncConversations();
```

### Incremental Sync with Updates

```typescript
const { syncConversationsIncremental, isSyncing } = useChatSync(relays);

// With callbacks for real-time updates
await syncConversationsIncremental(
  (conversation) => {
    console.log('Conversation updated:', conversation.id);
    // Update UI immediately
  },
  (allConversations) => {
    console.log('Sync complete:', allConversations.length);
  }
);
```

### In useConversationState

```typescript
const syncWithNostr = useCallback(async () => {
  await syncConversationsIncremental(
    handleConversationUpdate,  // Updates state as events arrive
    (finalConversations) => {
      console.log(`Loaded ${finalConversations.length} conversations`);
    }
  );
}, [syncConversationsIncremental, handleConversationUpdate]);
```

## Migration Guide

### For Existing Code

No changes required! The existing `syncConversations()` function still works:

```typescript
// This continues to work
const conversations = await syncConversations();
```

### To Enable Incremental Updates

Replace `syncConversations()` with `syncConversationsIncremental()` and provide callbacks:

```typescript
// Before
const conversations = await syncConversations();
setConversations(conversations);

// After
await syncConversationsIncremental(
  (conv) => setConversations(prev => [...prev, conv]),
  (allConvs) => console.log('Done!')
);
```

## Testing Recommendations

### Unit Tests

1. **Event Processing Utilities**
   - Test decryption with valid/invalid events
   - Test message conversion
   - Test title generation
   - Test conversation updates

2. **Storage Manager**
   - Test debouncing behavior
   - Test batch updates
   - Test flush operations
   - Test initialization

3. **Sync Functions**
   - Test incremental processing
   - Test callbacks
   - Test error handling
   - Test backward compatibility

### Integration Tests

1. Test complete sync flow
2. Test with multiple conversations
3. Test title updates with early messages
4. Test storage persistence

## Performance Considerations

### Memory Usage
- **Before**: All events loaded and processed in memory at once
- **After**: Events processed one at a time, lower peak memory

### Storage I/O
- **Before**: Potentially multiple localStorage writes
- **After**: Batched writes with 500ms debounce

### UI Responsiveness
- **Before**: UI blocks until all events processed
- **After**: UI updates incrementally, stays responsive

## Future Enhancements

1. **Real-time Subscriptions**: Integrate with `useChatSyncPro` for live event streaming
2. **Optimistic Updates**: Show local changes immediately before sync confirmation
3. **Conflict Resolution**: Handle concurrent edits from multiple devices
4. **Partial Sync**: Only fetch events since last sync timestamp
5. **Background Sync**: Sync in background without blocking UI
6. **Progress Indicators**: Show sync progress (X of Y events processed)

## Troubleshooting

### Events Not Appearing

Check that:
1. PNS keys are correctly derived
2. Events are properly encrypted/decrypted
3. Callbacks are being called
4. Storage manager is initialized

### Storage Not Persisting

Check that:
1. Storage manager flush is being called
2. Debounce delay hasn't prevented flush
3. No localStorage quota exceeded
4. Browser allows localStorage

### Title Not Updating

Check that:
1. Message has `_createdAt` timestamp
2. Message is actually earlier than existing messages
3. Conversation exists in state
4. Title generation is working

## Choosing Between Sync Modes

### Use `useChatSyncPro` when:
✅ You want real-time updates as events arrive
✅ You need live subscription to relay feeds
✅ You want automatic conversation management
✅ You're building a chat interface with live updates

### Use `useChatSync` when:
✅ You need on-demand sync (manual trigger)
✅ You want more control over the sync process
✅ You need to sync with specific callbacks
✅ You're implementing import/export features

### Use both when:
✅ You want real-time updates + manual refresh capability
✅ You need different sync strategies for different features

## API Reference

See individual file documentation:
- [`utils/eventProcessing.ts`](utils/eventProcessing.ts) - Event processing utilities
- [`utils/storageManager.ts`](utils/storageManager.ts) - Batched storage manager
- [`hooks/useChatSync.ts`](hooks/useChatSync.ts) - On-demand sync with incremental support
- [`hooks/useChatSyncPro.ts`](hooks/useChatSyncPro.ts) - Real-time streaming sync
- [`hooks/useConversationState.ts`](hooks/useConversationState.ts) - Conversation state management