# Zustand Event Database

A browser-compatible implementation of `IEventDatabase` using Zustand for use with applesauce-core `EventStore`.

## Features

- ✅ Persistent storage via localStorage
- ✅ Full IEventDatabase interface implementation
- ✅ Replaceable event support (kinds 10000-19999, 30000-39999)
- ✅ Filter-based queries
- ✅ Timeline retrieval
- ✅ Event history tracking

## Installation

The module is already integrated into the project. Import from `@/lib/eventDatabase`.

## Usage

### Basic Usage with Zustand Hook

```typescript
import { useEventDatabase } from '@/lib/eventDatabase';

function MyComponent() {
  const { add, getEvent, getByFilters, getStats } = useEventDatabase();

  // Add an event
  const handleAddEvent = (event: NostrEvent) => {
    add(event);
  };

  // Get an event by ID
  const event = getEvent('event-id-here');

  // Query events
  const chatEvents = getByFilters({
    kinds: [1080],  // PNS events
    authors: ['pubkey-here'],
  });

  // Get stats
  const { totalEvents, replaceableCount } = getStats();

  return <div>Total events: {totalEvents}</div>;
}
```

### With EventStore (Integrated)

The eventDatabase is automatically integrated with the global `eventStore`:

```typescript
import { eventStore, eventDatabase } from '@/lib/applesauce-core';

// EventStore now uses the Zustand database for persistence
eventStore.add(event);

// Or access the database directly
const chatEvents = eventDatabase.getByFilters({
  kinds: [1080],
  limit: 50,
});
```

### Direct Instance Usage

```typescript
import { getEventDatabaseInstance } from '@/lib/eventDatabase';
import { EventStore } from 'applesauce-core';

// Get a plain object implementing IEventDatabase
const eventDatabase = getEventDatabaseInstance();

// Create a new EventStore with the database
const myEventStore = new EventStore(eventDatabase);
```

## API Reference

### Core Methods

| Method | Description |
|--------|-------------|
| `add(event)` | Add an event to the database |
| `remove(event)` | Remove an event by ID or event object |
| `hasEvent(id)` | Check if an event exists |
| `getEvent(id)` | Get an event by ID |

### Replaceable Events

| Method | Description |
|--------|-------------|
| `hasReplaceable(kind, pubkey, identifier?)` | Check if a replaceable event exists |
| `getReplaceable(kind, pubkey, identifier?)` | Get the latest version of a replaceable event |
| `getReplaceableHistory(kind, pubkey, identifier?)` | Get all versions of a replaceable event |

### Filtering

| Method | Description |
|--------|-------------|
| `getByFilters(filters)` | Get events matching the filter(s) |
| `getTimeline(filters)` | Get events sorted by created_at (descending) |
| `removeByFilters(filters)` | Remove all events matching the filter(s) |

### Utility

| Method | Description |
|--------|-------------|
| `clearStore()` | Remove all events from the database |
| `getStats()` | Get statistics about stored events |

## Filter Examples

```typescript
// Single filter
const events = getByFilters({
  kinds: [1, 6],
  authors: ['pubkey1', 'pubkey2'],
  since: Math.floor(Date.now() / 1000) - 86400, // Last 24 hours
  limit: 100,
});

// Multiple filters (union - events matching ANY filter)
const events = getByFilters([
  { kinds: [1], authors: ['alice'] },
  { kinds: [1], authors: ['bob'] },
]);

// Tag filters
const events = getByFilters({
  kinds: [1],
  '#e': ['event-id'], // Events referencing this event
  '#p': ['pubkey'],   // Events mentioning this pubkey
});
```

## Replaceable Events

The database automatically handles replaceable events according to NIP-01:

- **Kinds 10000-19999**: Regular replaceable events (unique by kind + pubkey)
- **Kinds 30000-39999**: Parameterized replaceable events (unique by kind + pubkey + d-tag)

```typescript
// Add a profile update (kind 0 is actually special, but for example)
add(profileEvent1);
add(profileEvent2); // Newer version

// Only get the latest
const profile = getReplaceable(0, pubkey);

// Get all versions
const history = getReplaceableHistory(0, pubkey);
```

## Persistence

Events are automatically persisted to localStorage under the key `nostr-event-store`. The data persists across browser sessions and page reloads.

### Storage Considerations

- Maximum storage: ~5-10MB (browser dependent)
- Recommended: Keep under 5000 events
- Performance: Acceptable for up to 10000 events

### Clearing Storage

```typescript
// Clear all events
useEventDatabase.getState().clearStore();

// Or remove old events
const removed = removeByFilters({
  until: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // Older than 30 days
});
```

## Limitations

1. **No Full-Text Search**: NIP-50 search is not supported
2. **O(n) Filter Queries**: No SQL indexing, filters scan all events
3. **LocalStorage Limits**: ~5-10MB maximum storage
4. **No Cross-Tab Sync**: Changes don't sync in real-time across browser tabs
5. **No Transactions**: Operations are atomic but no multi-operation transactions

## File Structure

```
lib/eventDatabase/
├── index.ts          # Public exports
├── eventStore.ts     # Main Zustand store implementation
├── types.ts          # TypeScript type definitions
├── filters.ts        # Filter matching logic
├── replaceables.ts   # Replaceable event utilities
└── README.md         # This file
```

## Integration with useChatSync

The eventDatabase is used by the chat sync functionality:

```typescript
// In useChatSync.ts
import { eventStore } from '@/lib/applesauce-core';

// Events added to eventStore are now persisted
eventStore.add(pnsEvent);
```

## Testing

```typescript
import { useEventDatabase } from '@/lib/eventDatabase';

// Clear before tests
beforeEach(() => {
  useEventDatabase.getState().clearStore();
});

// Test adding events
test('adds event correctly', () => {
  const { add, getEvent } = useEventDatabase.getState();
  
  const event = { id: 'test', kind: 1, /* ... */ };
  add(event);
  
  expect(getEvent('test')).toEqual(event);
});