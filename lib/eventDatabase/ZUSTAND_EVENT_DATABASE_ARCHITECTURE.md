# 🏗️ Zustand-based Event Database Architecture Plan

## Overview

This document outlines the architecture for implementing an `IEventDatabase` interface using Zustand for browser-based Nostr event storage. This will serve as a complementary layer to the applesauce-core `EventStore`.

## Requirements Summary

- **Storage Size**: ~1000-5000 events
- **Performance**: Not critical (basic queries acceptable)
- **Persistence**: Required (using Zustand persist middleware)
- **Integration**: Complementary to EventStore (EventStore accepts IEventDatabase in constructor)
- **Search**: Skip full-text search (NIP-50)
- **Primary Use Case**: Caching chat messages (PNS events)

## Feasibility Analysis

### ✅ Feasible Features

| Method                       | Implementation            | Notes               |
| ---------------------------- | ------------------------- | ------------------- |
| `add(event)`                 | O(1) map insertion        | Straightforward     |
| `remove(event)`              | O(1) map deletion         | Direct lookup       |
| `hasEvent(id)`               | O(1) existence check      | Simple map lookup   |
| `getEvent(id)`               | O(1) retrieval            | Direct access       |
| `hasReplaceable(...)`        | O(1) index lookup         | Composite key index |
| `getReplaceable(...)`        | O(1) retrieval            | Index-based         |
| `getReplaceableHistory(...)` | O(h) where h=history size | Array iteration     |
| `getByFilters(filters)`      | O(n) linear scan          | No SQL indexing     |
| `getTimeline(filters)`       | O(n log n) with sort      | Filter + sort       |
| `removeByFilters(filters)`   | O(n) scan + delete        | Batch removal       |

### ⚠️ Limitations

1. **No FTS**: Full-text search not supported (skipped per requirements)
2. **Filter Performance**: O(n) instead of indexed lookups
3. **Storage Limits**: LocalStorage ~5-10MB = max ~5000-10000 events
4. **No Transactions**: Zustand updates are atomic but no multi-operation transactions
5. **Cross-tab Sync**: Requires storage event listeners (not built-in)

## Data Structure Design

### Core State Shape

```typescript
interface EventStoreState {
  // Primary storage: event ID -> NostrEvent
  events: Record<string, NostrEvent>;

  // Replaceable event index: "kind:pubkey:identifier" -> latest event ID
  replaceableIndex: Record<string, string>;

  // Replaceable history: "kind:pubkey:identifier" -> event ID array (newest first)
  replaceableHistory: Record<string, string[]>;

  // Optional: Tag index for common queries
  // Format: "tagName:tagValue" -> event ID array
  tagIndex?: Record<string, string[]>;

  // Methods (IEventDatabase interface)
  add: (event: NostrEvent) => NostrEvent;
  remove: (event: string | NostrEvent) => boolean;
  removeByFilters: (filters: Filter | Filter[]) => number;
  hasEvent: (id: string) => boolean;
  getEvent: (id: string) => NostrEvent | undefined;
  hasReplaceable: (
    kind: number,
    pubkey: string,
    identifier?: string
  ) => boolean;
  getReplaceable: (
    kind: number,
    pubkey: string,
    identifier?: string
  ) => NostrEvent | undefined;
  getReplaceableHistory: (
    kind: number,
    pubkey: string,
    identifier?: string
  ) => NostrEvent[] | undefined;
  getByFilters: (filters: Filter | Filter[]) => NostrEvent[];
  getTimeline: (filters: Filter | Filter[]) => NostrEvent[];

  // Utility methods
  clearStore: () => void;
  getStats: () => { totalEvents: number; replaceableCount: number };
}
```

### Key Design Decisions

1. **Record vs Array**: Use `Record<string, NostrEvent>` for O(1) lookups by ID
2. **Composite Keys**: Format `"kind:pubkey:identifier"` for replaceable event indexing
3. **History as Arrays**: Newest events first for efficient access
4. **Optional Tag Index**: Build on-demand for performance-critical queries

## Replaceable Event Handling

### Replaceable Event Detection

```typescript
function isReplaceable(kind: number): boolean {
  // Kinds 10000-19999 and 30000-39999 are replaceable
  return (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000);
}

function isParameterized(kind: number): boolean {
  // Kinds 30000-39999 use 'd' tag as identifier
  return kind >= 30000 && kind < 40000;
}

function getReplaceableKey(
  kind: number,
  pubkey: string,
  identifier: string = ""
): string {
  return `${kind}:${pubkey}:${identifier}`;
}
```

### Add Logic for Replaceable Events

```typescript
// When adding a replaceable event:
1. Generate composite key
2. Check if newer than existing version (compare created_at)
3. If newer:
   - Update replaceableIndex to point to new event
   - Prepend to replaceableHistory array
4. Always add to events map (keep all versions)
```

### Identifier Extraction

```typescript
function getIdentifier(event: NostrEvent, kind: number): string {
  if (!isParameterized(kind)) return "";

  const dTag = event.tags.find((t) => t[0] === "d");
  return dTag && dTag[1] ? dTag[1] : "";
}
```

## Filter Implementation

### Filter Matching Algorithm

```typescript
function matchesFilter(event: NostrEvent, filter: Filter): boolean {
  // 1. Match IDs (prefix matching)
  if (filter.ids) {
    if (!filter.ids.some((id) => event.id.startsWith(id))) return false;
  }

  // 2. Match authors (prefix matching)
  if (filter.authors) {
    if (!filter.authors.some((author) => event.pubkey.startsWith(author)))
      return false;
  }

  // 3. Match kinds (exact match)
  if (filter.kinds) {
    if (!filter.kinds.includes(event.kind)) return false;
  }

  // 4. Match time range
  if (filter.since && event.created_at < filter.since) return false;
  if (filter.until && event.created_at > filter.until) return false;

  // 5. Match tags (#e, #p, etc.)
  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#")) {
      const tagName = key.slice(1);
      const eventTagValues = event.tags
        .filter((t) => t[0] === tagName)
        .map((t) => t[1]);

      if (!values.some((v) => eventTagValues.includes(v))) return false;
    }
  }

  return true;
}
```

### Multi-Filter Support

```typescript
function getByFilters(filters: Filter | Filter[]): NostrEvent[] {
  const filterArray = Array.isArray(filters) ? filters : [filters];
  const allEvents = Object.values(this.events);

  // Union: event matches if it matches ANY filter
  const matchingEvents = allEvents.filter((event) =>
    filterArray.some((filter) => matchesFilter(event, filter))
  );

  // Apply limit if specified (use smallest limit across all filters)
  const limit = Math.min(...filterArray.map((f) => f.limit || Infinity));

  if (limit !== Infinity) {
    return matchingEvents.slice(0, limit);
  }

  return matchingEvents;
}
```

## Persistence Strategy

### Zustand Persist Middleware

```typescript
import { persist, createJSONStorage } from "zustand/middleware";

const useEventStore = create<EventStoreState>()(
  persist(
    (set, get) => ({
      events: {},
      replaceableIndex: {},
      replaceableHistory: {},

      // ... methods
    }),
    {
      name: "nostr-event-store",
      storage: createJSONStorage(() => localStorage),

      // Only persist data, not methods
      partialize: (state) => ({
        events: state.events,
        replaceableIndex: state.replaceableIndex,
        replaceableHistory: state.replaceableHistory,
      }),

      // Optional: Merge strategy for hydration
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...persistedState,
      }),
    }
  )
);
```

### Storage Size Management

```typescript
// Monitor storage usage
function getStorageSize(): number {
  const str = JSON.stringify(localStorage);
  return new Blob([str]).size;
}

// Implement LRU eviction (optional)
function pruneOldEvents(beforeTimestamp: number): number {
  // Remove events older than timestamp
  // Update indexes accordingly
}

// Utility to check if near storage limit
function isNearStorageLimit(): boolean {
  const size = getStorageSize();
  const limit = 5 * 1024 * 1024; // 5MB
  return size > limit * 0.8; // 80% of limit
}
```

## File Structure

```
lib/
  eventDatabase/
    index.ts                 # Public exports
    eventStore.ts           # Main Zustand store implementation
    types.ts                # TypeScript type definitions
    filters.ts              # Filter matching logic
    replaceables.ts         # Replaceable event utilities
    utils.ts                # Helper functions
    README.md               # Usage documentation
```

## Integration with EventStore

### Current Usage (useChatSync.ts:102)

```typescript
const store = new EventStore();
```

### After Implementation

```typescript
import { useEventStore } from "@/lib/eventDatabase";
import { EventStore } from "applesauce-core";

// Get the event database instance
const eventDatabase = useEventStore.getState();

// Pass to EventStore constructor
const store = new EventStore(eventDatabase);

// EventStore will now use our Zustand-based database for storage
```

### Singleton Pattern

```typescript
// Create a singleton EventStore instance
let eventStoreInstance: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!eventStoreInstance) {
    const eventDatabase = useEventStore.getState();
    eventStoreInstance = new EventStore(eventDatabase);
  }
  return eventStoreInstance;
}
```

## Performance Optimizations

### For 1000-5000 Events

1. **Batch Operations**

   ```typescript
   function addBatch(events: NostrEvent[]): void {
     set((state) => {
       const newEvents = { ...state.events };
       const newIndex = { ...state.replaceableIndex };
       const newHistory = { ...state.replaceableHistory };

       for (const event of events) {
         // Batch process all events
         // Update structures
       }

       return {
         events: newEvents,
         replaceableIndex: newIndex,
         replaceableHistory: newHistory,
       };
     });
   }
   ```

2. **Lazy Tag Indexing**

   ```typescript
   // Build tag index only when needed
   function buildTagIndex(tagName: string): void {
     const index: Record<string, string[]> = {};

     for (const event of Object.values(this.events)) {
       event.tags
         .filter((t) => t[0] === tagName)
         .forEach((t) => {
           const value = t[1];
           if (!index[value]) index[value] = [];
           index[value].push(event.id);
         });
     }

     set({ tagIndex: { ...this.tagIndex, [`${tagName}:*`]: index } });
   }
   ```

3. **Memoized Filter Results**

   ```typescript
   const filterCache = new Map<string, NostrEvent[]>();

   function getByFiltersCached(filters: Filter | Filter[]): NostrEvent[] {
     const key = JSON.stringify(filters);
     if (filterCache.has(key)) {
       return filterCache.get(key)!;
     }

     const results = getByFilters(filters);
     filterCache.set(key, results);
     return results;
   }
   ```

4. **Debounced Persistence**
   ```typescript
   // Prevent excessive localStorage writes
   const debouncedPersist = debounce(() => {
     // Trigger manual persistence if needed
   }, 1000);
   ```

## Implementation Phases

### Phase 1: Core Storage (Priority: High)

- [ ] Create type definitions matching IEventDatabase
- [ ] Implement basic Zustand store structure
- [ ] Add `add()` method with event storage
- [ ] Add `remove()` method
- [ ] Implement `hasEvent()` and `getEvent()`
- [ ] Add persistence with Zustand persist middleware
- [ ] Write unit tests for core operations

### Phase 2: Replaceable Events (Priority: High)

- [ ] Implement replaceable detection logic
- [ ] Add replaceable index management
- [ ] Implement `getReplaceable()` with latest version logic
- [ ] Add `hasReplaceable()` check
- [ ] Implement `getReplaceableHistory()` with all versions
- [ ] Handle replaceable event updates correctly
- [ ] Write tests for replaceable event scenarios

### Phase 3: Filtering (Priority: Medium)

- [ ] Implement filter matching algorithm
- [ ] Add multi-filter support (union logic)
- [ ] Implement `getByFilters()` method
- [ ] Add `getTimeline()` with sorting
- [ ] Implement `removeByFilters()` for batch deletion
- [ ] Handle edge cases (empty filters, limit, etc.)
- [ ] Write comprehensive filter tests

### Phase 4: Integration & Documentation (Priority: Medium)

- [ ] Integrate with EventStore in useChatSync.ts
- [ ] Create singleton EventStore instance
- [ ] Add usage examples and documentation
- [ ] Test with real chat data/PNS events
- [ ] Add storage size monitoring
- [ ] Document known limitations
- [ ] Create migration guide

### Phase 5: Optimizations (Priority: Low)

- [ ] Implement batch operations
- [ ] Add optional tag indexing
- [ ] Implement storage pruning/LRU eviction
- [ ] Add performance monitoring
- [ ] Optimize filter queries
- [ ] Add cross-tab synchronization (optional)

## Known Limitations & Workarounds

| Limitation                | Impact                       | Severity | Workaround                               |
| ------------------------- | ---------------------------- | -------- | ---------------------------------------- |
| No SQL indexing           | O(n) filter queries          | Medium   | Pre-build tag indexes for common queries |
| LocalStorage size (~10MB) | Max ~5000-10000 events       | Low      | Implement event pruning/archival         |
| No transactions           | Potential race conditions    | Low      | Zustand updates are atomic per operation |
| O(n) filter matching      | Scales linearly with events  | Low      | Acceptable for <5000 events (~5-10ms)    |
| No real-time cross-tab    | State not synced across tabs | Low      | Use storage event listeners              |
| No FTS                    | Can't search event content   | N/A      | Skipped per requirements                 |

## Usage Examples

### Basic Usage

```typescript
import { useEventStore } from "@/lib/eventDatabase";

// In a component or hook
const { add, getEvent, getByFilters } = useEventStore();

// Add an event
const event: NostrEvent = {
  /* ... */
};
add(event);

// Get an event by ID
const retrieved = getEvent(event.id);

// Query events
const chatEvents = getByFilters({
  kinds: [1080], // PNS events
  authors: [pubkey],
});
```

### With EventStore

```typescript
import { getEventStore } from "@/lib/eventDatabase";

// Get the singleton EventStore instance
const eventStore = getEventStore();

// Now EventStore uses our Zustand database
eventStore.add(event);

// Subscribe to events
eventStore.event(eventId).subscribe((event) => {
  console.log("Event updated:", event);
});
```

### Advanced Filtering

```typescript
// Get timeline of last 50 messages
const timeline = useEventStore.getState().getTimeline({
  kinds: [1080],
  authors: [pubkey],
  limit: 50,
});

// Get events by multiple filters (union)
const events = useEventStore.getState().getByFilters([
  { kinds: [1], authors: [user1] },
  { kinds: [1], authors: [user2] },
]);

// Get replaceable event
const profile = useEventStore.getState().getReplaceable(
  0, // kind: metadata
  pubkey, // author
  "" // no identifier for kind 0
);
```

### Storage Management

```typescript
// Check storage usage
const stats = useEventStore.getState().getStats();
console.log(`Stored ${stats.totalEvents} events`);

// Prune old events
const removed = useEventStore.getState().removeByFilters({
  until: Date.now() / 1000 - 30 * 24 * 60 * 60, // Older than 30 days
});
console.log(`Removed ${removed} old events`);

// Clear entire store
useEventStore.getState().clearStore();
```

## Testing Strategy

### Unit Tests

1. **Core Operations**
   - Add/remove events
   - Event existence checks
   - Event retrieval

2. **Replaceable Events**
   - Latest version retrieval
   - History tracking
   - Update scenarios

3. **Filter Matching**
   - Single filter matching
   - Multi-filter union
   - Edge cases (empty, limits)

### Integration Tests

1. **EventStore Integration**
   - Constructor injection
   - Event synchronization
   - Observable streams

2. **Persistence**
   - LocalStorage hydration
   - Cross-session persistence
   - Storage limits

### Performance Tests

1. **Scalability**
   - 1000 events: <5ms queries
   - 5000 events: <20ms queries
   - 10000 events: <50ms queries

2. **Memory Usage**
   - Monitor heap size
   - Check for memory leaks
   - Storage size tracking

## Success Criteria

- ✅ Implements complete IEventDatabase interface
- ✅ Persists events across browser sessions
- ✅ Handles 1000-5000 events efficiently
- ✅ Integrates seamlessly with EventStore
- ✅ Properly manages replaceable events
- ✅ Filter queries complete in <50ms for 5000 events
- ✅ Comprehensive documentation and examples
- ✅ Full test coverage (>80%)

## Next Steps

1. Review and approve this architecture plan
2. Switch to Code mode to begin implementation
3. Start with Phase 1 (Core Storage)
4. Iteratively implement remaining phases
5. Integrate with existing chat sync functionality

## References

- [IEventDatabase Interface](https://github.com/hzrd149/applesauce/blob/master/packages/core/src/event-store/interfaces.ts)
- [Zustand Documentation](https://docs.pmnd.rs/zustand/)
- [Zustand Persist Middleware](https://docs.pmnd.rs/zustand/integrations/persisting-store-data)
- [Nostr NIPs](https://github.com/nostr-protocol/nips)
- [Replaceable Events (NIP-01)](https://github.com/nostr-protocol/nips/blob/master/01.md#kinds)
