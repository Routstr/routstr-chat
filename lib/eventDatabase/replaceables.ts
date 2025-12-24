import { NostrEvent } from "nostr-tools";

/**
 * Check if a kind is replaceable (10000-19999 range)
 */
export function isReplaceable(kind: number): boolean {
  return kind >= 10000 && kind < 20000;
}

/**
 * Check if a kind is parameterized replaceable (30000-39999 range)
 * These use the 'd' tag as an identifier
 */
export function isParameterizedReplaceable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

/**
 * Check if a kind is any type of replaceable event
 */
export function isAnyReplaceable(kind: number): boolean {
  return isReplaceable(kind) || isParameterizedReplaceable(kind);
}

/**
 * Get the 'd' tag identifier from an event
 * Returns empty string if no 'd' tag is found
 */
export function getIdentifier(event: NostrEvent): string {
  if (!isParameterizedReplaceable(event.kind)) {
    return "";
  }

  const dTag = event.tags.find((t) => t[0] === "d");
  return dTag && dTag[1] ? dTag[1] : "";
}

/**
 * Generate a composite key for replaceable events
 * Format: "kind:pubkey:identifier"
 */
export function getReplaceableKey(
  kind: number,
  pubkey: string,
  identifier: string = ""
): string {
  return `${kind}:${pubkey}:${identifier}`;
}

/**
 * Generate a composite key for an event (if it's replaceable)
 */
export function getEventReplaceableKey(event: NostrEvent): string | null {
  if (!isAnyReplaceable(event.kind)) {
    return null;
  }

  const identifier = getIdentifier(event);
  return getReplaceableKey(event.kind, event.pubkey, identifier);
}

/**
 * Compare two events to determine which is newer
 * Returns true if eventA is newer than eventB
 */
export function isNewerEvent(eventA: NostrEvent, eventB: NostrEvent): boolean {
  // First compare by created_at timestamp
  if (eventA.created_at !== eventB.created_at) {
    return eventA.created_at > eventB.created_at;
  }

  // If timestamps are equal, compare by event ID (lexicographic comparison)
  // This ensures deterministic ordering
  return eventA.id > eventB.id;
}
