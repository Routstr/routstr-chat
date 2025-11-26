/**
 * Zustand-based Event Database
 * 
 * A browser-compatible implementation of IEventDatabase using Zustand
 * for use with applesauce-core EventStore.
 * 
 * @example
 * ```typescript
 * import { useEventDatabase, getEventDatabaseInstance } from '@/lib/eventDatabase';
 * import { EventStore } from 'applesauce-core';
 * 
 * // Option 1: Use the Zustand hook in React components
 * const { add, getEvent, getByFilters } = useEventDatabase();
 * 
 * // Option 2: Get a plain object for use with EventStore
 * const eventDatabase = getEventDatabaseInstance();
 * const eventStore = new EventStore(eventDatabase);
 * ```
 */

// Main exports
export { useEventDatabase, getEventDatabaseInstance, default } from './eventStore';

// Type exports
export type { 
  IEventDatabase, 
  EventStoreState, 
  EventStoreStats, 
  Filter 
} from './types';

// Utility exports
export { 
  isReplaceable, 
  isParameterizedReplaceable, 
  isAnyReplaceable,
  getIdentifier,
  getReplaceableKey,
  getEventReplaceableKey,
  isNewerEvent
} from './replaceables';

export {
  matchesFilter,
  matchesAnyFilter,
  filterEvents,
  getTimeline
} from './filters';