import { useEffect, useState, useRef, useCallback } from 'react'
import { Relay, onlyEvents, RelayPool } from 'applesauce-relay'
import { BehaviorSubject, filter, shareReplay, switchMap, takeWhile, defaultIfEmpty, combineLatest, merge, tap } from 'rxjs'
import type { NostrEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { KIND_PNS, PnsKeys } from '@/lib/pns'
import { useAppContext } from '@/hooks/useAppContext'
import { Conversation } from '@/types/chat'
import {
  decryptPnsEventToInner,
  processInnerEvent,
} from '@/utils/eventProcessing'

// Relay pool so we reuse relay instances by URL
const relayPool = new Map<string, Relay>()
function getRelay(url: string): Relay {
  let r = relayPool.get(url)
  if (!r) {
    r = new Relay(url)
    // Keep connection alive for real-time updates
    r.keepAlive = 30000 // 30 seconds
    relayPool.set(url, r)
  }
  return r
}

// Reactive relay URLs input - exported so it can be updated from the component
export const relayUrls$ = new BehaviorSubject<string[]>([])
const relayUrlsDefined$ = relayUrls$.pipe(
  filter((urls): urls is string[] => {
    return urls.length > 0
  }),
  shareReplay(1),
)

// Reactive PNS keys input - exported so it can be updated from ChatProvider
export const pnsKeys$ = new BehaviorSubject<PnsKeys | null>(null)
const pnsKeysDefined$ = pnsKeys$.pipe(
  filter((keys): keys is PnsKeys => {
    return keys !== null
  }),
  shareReplay(1),
)

// Track relay event counts
const relayEventCounts = new Map<string, number>()

// Fetch kind 1080 events from configured relays
const kind1080Events$ = combineLatest([pnsKeysDefined$, relayUrlsDefined$]).pipe(
  switchMap(([pnsKeys, relayUrls]) => {
    // Reset counts for new subscription
    relayEventCounts.clear()
    
    // Query all configured relays and merge results
    const relaySubscriptions = relayUrls.map((url) => {
      const relay = getRelay(url)
      return relay
        .subscription({ kinds: [KIND_PNS], authors: [pnsKeys.pnsKeypair.pubKey] })
        .pipe(
          // Keep subscription open for real-time events (don't stop at EOSE)
          onlyEvents(),
          tap(() => {
            // Increment count for this relay
            relayEventCounts.set(url, (relayEventCounts.get(url) || 0) + 1)
          }),
        )
    })
    
    // Merge all relay subscriptions into a single stream
    return merge(...relaySubscriptions).pipe(defaultIfEmpty(null))
  }),
  shareReplay(1),
)

export function useChatSyncPro() {
  const { config } = useAppContext()
  const [events, setEvents] = useState<NostrEvent[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const relayCountsRef = useRef<Map<string, number>>(new Map())
  const conversationsMapRef = useRef<Map<string, Conversation>>(new Map())
  const [currentPnsKeys, setCurrentPnsKeys] = useState<PnsKeys | null>(null)

  // Subscribe to PNS keys from the observable
  useEffect(() => {
    const sub = pnsKeys$.subscribe(setCurrentPnsKeys)
    return () => sub.unsubscribe()
  }, [])

  // Update relay URLs when config changes
  useEffect(() => {
    if (config.relayUrls.length > 0) {
      relayUrls$.next(config.relayUrls)
    }
  }, [config.relayUrls])

  useEffect(() => {
    // Update local ref with current relay counts
    relayCountsRef.current = new Map(relayEventCounts)
    
    // Log event counts per relay
    const counts = Object.fromEntries(relayCountsRef.current)
    console.log('Events per relay:', counts, '| Total unique events:', events.length)
  }, [events])

  // Process event and update conversations
  const processEvent = useCallback((event: NostrEvent) => {
    if (!currentPnsKeys) {
      console.warn('Cannot process event: PNS keys not available')
      return
    }

    // Decrypt and process the event
    const innerEvent = decryptPnsEventToInner(event, currentPnsKeys)
    if (!innerEvent) {
      return
    }

    // Update conversations map
    processInnerEvent(conversationsMapRef.current, innerEvent)

    // Update state with new conversations array
    const updatedConversations = Array.from(conversationsMapRef.current.values())

    setConversations(updatedConversations)
  }, [currentPnsKeys])

  // Subscribe to kind 1080 events
  useEffect(() => {
    setLoading(true)

    const sub = kind1080Events$.subscribe({
      next: (event) => {
        if (event) {
          // Update raw events array
          setEvents((prev) => {
            // Avoid duplicates
            if (prev.some((e) => e.id === event.id)) {
              return prev
            }
            // Add new event and sort by created_at descending
            const newEvents = [...prev, event].sort((a, b) => b.created_at - a.created_at)
            return newEvents
          })

          // Process event and update conversations
          processEvent(event)
        }
        setLoading(false)
      },
      error: (err) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      },
      complete: () => {
        setLoading(false)
      },
    })

    return () => {
      sub.unsubscribe()
    }
  }, [processEvent])

  return {
    events,
    conversations,
    loading,
    error,
  }
}