import { useEffect, useState } from 'react'
import { Relay, onlyEvents } from 'applesauce-relay'
import { BehaviorSubject, filter, shareReplay, switchMap, takeWhile, defaultIfEmpty, combineLatest } from 'rxjs'
import type { NostrEvent } from 'nostr-tools'
import { KIND_PNS } from '@/lib/pns'
import { useAppContext } from '@/hooks/useAppContext'

// Relay pool so we reuse relay instances by URL
const relayPool = new Map<string, Relay>()
function getRelay(url: string): Relay {
  let r = relayPool.get(url)
  if (!r) {
    r = new Relay(url)
    r.keepAlive = 0
    relayPool.set(url, r)
  }
  return r
}

// Reactive relay URLs input - exported so it can be updated from the component
export const relayUrls$ = new BehaviorSubject<string[]>([])
const relayUrlsDefined$ = relayUrls$.pipe(
  filter((urls): urls is string[] => {
    console.log('[relayUrls$ filter] Received relay URLs:', urls)
    return urls.length > 0
  }),
  shareReplay(1),
)

// Reactive pubkey input - exported so it can be updated from ChatProvider
export const pubkey$ = new BehaviorSubject<string | null>(null)
const pubkeyDefined$ = pubkey$.pipe(
  filter((p): p is string => {
    console.log('[pubkey$ filter] Received pubkey:', p)
    return p !== null
  }),
  shareReplay(1),
)

// Fetch kind 1080 events from configured relays
const kind1080Events$ = combineLatest([pubkeyDefined$, relayUrlsDefined$]).pipe(
  switchMap(([pubkey, relayUrls]) => {
    console.log('[kind1080Events$] switchMap triggered for pubkey:', pubkey, 'relays:', relayUrls)
    // Use the first configured relay for fetching kind 1080 events
    const relay = getRelay(relayUrls[0])
    console.log('[kind1080Events$] Creating subscription to relay:', relayUrls[0])
    
    return relay
      .subscription({ kinds: [KIND_PNS], authors: [pubkey] })
      .pipe(
        takeWhile((v) => {
          console.log('[kind1080Events$] Received value:', v)
          return v !== 'EOSE'
        }),
        onlyEvents(),
        defaultIfEmpty(null),
      )
  }),
  shareReplay(1),
)

export function useChatSyncPro() {
  const { config } = useAppContext()
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Update relay URLs when config changes
  useEffect(() => {
    if (config.relayUrls.length > 0) {
      console.log('[useChatSyncPro] Updating relay URLs:', config.relayUrls)
      relayUrls$.next(config.relayUrls)
    }
  }, [config.relayUrls])

  // Subscribe to kind 1080 events
  useEffect(() => {
    console.log('[useChatSyncPro] Hook initialized, subscribing to kind1080Events$')
    setLoading(true)

    const sub = kind1080Events$.subscribe({
      next: (event) => {
        console.log('[useChatSyncPro] Received event:', event)
        if (event) {
          setEvents((prev) => {
            // Avoid duplicates
            if (prev.some((e) => e.id === event.id)) {
              console.log('[useChatSyncPro] Duplicate event, skipping:', event.id)
              return prev
            }
            // Add new event and sort by created_at descending
            const newEvents = [...prev, event].sort((a, b) => b.created_at - a.created_at)
            console.log('[useChatSyncPro] Added new event, total events:', newEvents.length)
            return newEvents
          })
        } else {
          console.log('[useChatSyncPro] Received null event (probably EOSE)')
        }
        setLoading(false)
      },
      error: (err) => {
        console.error('[useChatSyncPro] Error:', err)
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      },
      complete: () => {
        console.log('[useChatSyncPro] Observable completed')
        setLoading(false)
      },
    })

    return () => {
      console.log('[useChatSyncPro] Unsubscribing')
      sub.unsubscribe()
    }
  }, [])

  return {
    events,
    loading,
    error,
  }
}