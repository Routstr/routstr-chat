import { NostrEvent } from 'nostr-tools';
import { Filter } from './types';

/**
 * Check if an event matches a single filter
 */
export function matchesFilter(event: NostrEvent, filter: Filter): boolean {
  // 1. Match IDs (prefix matching)
  if (filter.ids && filter.ids.length > 0) {
    if (!filter.ids.some(id => event.id.startsWith(id))) {
      return false;
    }
  }
  
  // 2. Match authors (prefix matching)
  if (filter.authors && filter.authors.length > 0) {
    if (!filter.authors.some(author => event.pubkey.startsWith(author))) {
      return false;
    }
  }
  
  // 3. Match kinds (exact match)
  if (filter.kinds && filter.kinds.length > 0) {
    if (!filter.kinds.includes(event.kind)) {
      return false;
    }
  }
  
  // 4. Match time range
  if (filter.since !== undefined && event.created_at < filter.since) {
    return false;
  }
  if (filter.until !== undefined && event.created_at > filter.until) {
    return false;
  }
  
  // 5. Match tag filters (#e, #p, #d, etc.)
  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith('#') && values && Array.isArray(values) && values.length > 0) {
      const tagName = key.slice(1);
      const eventTagValues = event.tags
        .filter(t => t[0] === tagName)
        .map(t => t[1]);
      
      // Check if any of the filter values match any of the event's tag values
      if (!values.some(v => eventTagValues.includes(v))) {
        return false;
      }
    }
  }
  
  // Event matches all filter criteria
  return true;
}

/**
 * Check if an event matches any of the filters (union)
 */
export function matchesAnyFilter(event: NostrEvent, filters: Filter[]): boolean {
  if (filters.length === 0) {
    return true; // No filters means match all
  }
  
  return filters.some(filter => matchesFilter(event, filter));
}

/**
 * Filter events by a single filter or array of filters
 * Returns events that match ANY of the filters (union)
 */
export function filterEvents(events: NostrEvent[], filters: Filter | Filter[]): NostrEvent[] {
  const filterArray = Array.isArray(filters) ? filters : [filters];
  
  if (filterArray.length === 0) {
    return [...events];
  }
  
  // Filter events that match any filter
  const matchingEvents = events.filter(event => matchesAnyFilter(event, filterArray));
  
  // Apply limit if specified (use smallest limit across all filters)
  const limits = filterArray
    .map(f => f.limit)
    .filter((limit): limit is number => limit !== undefined);
  
  if (limits.length > 0) {
    const minLimit = Math.min(...limits);
    return matchingEvents.slice(0, minLimit);
  }
  
  return matchingEvents;
}

/**
 * Get timeline of events (sorted by created_at descending)
 */
export function getTimeline(events: NostrEvent[], filters: Filter | Filter[]): NostrEvent[] {
  const filtered = filterEvents(events, filters);
  
  // Sort by created_at descending (newest first)
  return filtered.sort((a, b) => b.created_at - a.created_at);
}