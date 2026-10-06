import type { Filter, NostrEvent } from "nostr-tools";
import type { Observable } from "rxjs";

/** What the relay layer needs from a relay library (platform/nostr/pool.ts). */
export interface RelayPort {
  /** Stored events for a filter; completes at EOSE, errors when the relay fails. */
  request(url: string, filter: Filter): Observable<NostrEvent>;
  /** Events as relays receive them. */
  subscribe(urls: string[], filter: Filter): Observable<NostrEvent>;
  /** Resolves true when the relay accepted the event. */
  publish(url: string, event: NostrEvent): Promise<boolean>;
  /**
   * NIP-77: which of `local` the relay lacks (have) and which ids it holds
   * that `local` lacks (need). Null when the relay does not do NIP-77;
   * rejects when the sync fails or `signal` stops it.
   */
  reconcile(
    url: string,
    filter: Filter,
    local: NostrEvent[],
    signal: AbortSignal
  ): Promise<{ have: string[]; need: string[] } | null>;
}
