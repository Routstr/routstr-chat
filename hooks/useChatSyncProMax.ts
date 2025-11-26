import { useEffect, useState, useRef } from 'react'
import { BehaviorSubject, filter, shareReplay, combineLatest, switchMap, tap } from 'rxjs'
import type { NostrEvent } from 'nostr-tools'
import { KIND_PNS, PnsKeys } from '@/lib/pns'
import { useAppContext } from '@/hooks/useAppContext'
import { eventStore, relayPool } from '@/lib/applesauce-core'
import { SyncDirection } from 'applesauce-relay'

// Reactive relay URLs input - exported so it can be updated from the component
export const relayUrls$ = new BehaviorSubject<string[]>([])
const relayUrlsDefined$ = relayUrls$.pipe(
  filter((urls): urls is string[] => {
    return urls.length > 0
  }),
  shareReplay(1),
)

// Reactive PNS keys input - exported so it can be updated from ChatProvider
export const pnsKeysMax$ = new BehaviorSubject<PnsKeys | null>(null)
const pnsKeysDefined$ = pnsKeysMax$.pipe(
  filter((keys): keys is PnsKeys => {
    return keys !== null
  }),
  shareReplay(1),
)

// Track sync statistics
const syncStats = {
  eventsReceived: 0,
  lastSyncTime: null as Date | null,
}

// Sync kind 1080 events between eventStore and relays
const syncEvents$ = combineLatest([pnsKeysDefined$, relayUrlsDefined$]).pipe(
  switchMap(([pnsKeys, relayUrls]) => {
    // Reset sync stats for new sync
    syncStats.eventsReceived = 0
    syncStats.lastSyncTime = new Date()

    // Create the kind 1080 filter for this user's PNS events
    const kind1080Filter = {
      kinds: [KIND_PNS],
      authors: [pnsKeys.pnsKeypair.pubKey],
    }

    console.log('[useChatSyncProMax] Starting sync with filter:', kind1080Filter)
    console.log('[useChatSyncProMax] Syncing with relays:', relayUrls)

    // Use relayPool.sync to synchronize events between eventStore and relays
    // The sync function uses negentropy protocol for efficient synchronization
    return relayPool.sync(relayUrls, eventStore, kind1080Filter, SyncDirection.BOTH).pipe(
      tap((event) => {
        syncStats.eventsReceived++
        console.log('[useChatSyncProMax] Synced event:', event.id, 'Total:', syncStats.eventsReceived, eventStore.hasEvent(event.id))
        eventStore.add(event);
      }),
    )
  }),
  shareReplay(1),
)

export function useChatSyncProMax() {
  const { config } = useAppContext()
  const [syncedEvents, setSyncedEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPnsKeys, setCurrentPnsKeys] = useState<PnsKeys | null>(null)
  const syncCountRef = useRef(0)

  // Subscribe to PNS keys from the observable
  useEffect(() => {
    const sub = pnsKeysMax$.subscribe(setCurrentPnsKeys)
    return () => sub.unsubscribe()
  }, [])

  // Update relay URLs when config changes
  useEffect(() => {
    if (config.relayUrls.length > 0) {
      relayUrls$.next(config.relayUrls)
    }
  }, [config.relayUrls])

  // Subscribe to sync events
  useEffect(() => {
    setLoading(true) 

    const sub = syncEvents$.subscribe({
      next: (event) => {
        if (event) {
          syncCountRef.current++

          // Update synced events array
          setSyncedEvents((prev) => {
            // Avoid duplicates
            if (prev.some((e) => e.id === event.id)) {
              return prev
            }
            // Add new event and sort by created_at descending
            const newEvents = [...prev, event].sort((a, b) => b.created_at - a.created_at)
            return newEvents
          })
        }
        setLoading(false)
      },
      error: (err) => {
        console.error('[useChatSyncProMax] Sync error:', err)
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      },
      complete: () => {
        console.log('[useChatSyncProMax] Sync complete. Total events:', syncCountRef.current)
        setLoading(false)
      },
    })

    return () => {
      sub.unsubscribe()
    }
  }, [])

  // Log sync statistics
  useEffect(() => {
    console.log('[useChatSyncProMax] Synced events count:', syncedEvents.length, 'Last sync:', syncStats.lastSyncTime)
  }, [syncedEvents])

  return {
    syncedEvents,
    loading,
    error,
    currentPnsKeys,
    syncStats: {
      eventsReceived: syncStats.eventsReceived,
      lastSyncTime: syncStats.lastSyncTime,
    },
  }
}