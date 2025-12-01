import { useEffect, useState, useRef } from 'react'
import { BehaviorSubject, Subject, filter, shareReplay, combineLatest, switchMap, tap, map, defaultIfEmpty, merge, catchError, EMPTY } from 'rxjs'
import type { NostrEvent } from 'nostr-tools'
import { KIND_PNS, PnsKeys } from '@/lib/pns'
import { useAppContext } from '@/hooks/useAppContext'
import { eventStore, relayPool } from '@/lib/applesauce-core'
import { onlyEvents, SyncDirection } from 'applesauce-relay'
import { getStorageItem } from '@/utils/storageUtils'

// Storage key for chat sync enabled (shared with useChatSync.ts)
const CHAT_SYNC_ENABLED_KEY = 'chatSyncEnabled'

// Reactive chat sync enabled state - reads from localStorage
export const chatSyncEnabled$ = new BehaviorSubject<boolean>(
  typeof window !== 'undefined' ? getStorageItem<boolean>(CHAT_SYNC_ENABLED_KEY, true) : true
)

// Function to update chatSyncEnabled$ when storage changes
// This should be called from components that update the setting
export function updateChatSyncEnabled(enabled: boolean) {
  chatSyncEnabled$.next(enabled)
}

// Listen for storage events from other tabs (only in browser)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === CHAT_SYNC_ENABLED_KEY) {
      const newValue = e.newValue ? JSON.parse(e.newValue) : true
      chatSyncEnabled$.next(newValue)
    }
  })
}

// Reactive relay URLs input - exported so it can be updated from the component
export const relayUrls$ = new BehaviorSubject<string[]>([])

// Subject to trigger sync manually (e.g., after adding a new event to eventStore)
export const syncTrigger$ = new Subject<void>()

// Function to trigger a sync - call this after adding events to eventStore
export function triggerSync() {
  console.log('[useChatSyncProMax] Manual sync triggered')
  syncTrigger$.next()
}
const relayUrlsDefined$ = relayUrls$.pipe(
  filter((urls): urls is string[] => {
    return urls.length > 0
  }),
  shareReplay(1),
)

// Reactive PNS keys input - exported so it can be updated from ChatProvider
export const userPubkey$ = new BehaviorSubject<string | null>(null)
const userPubkeyDefined$ = userPubkey$.pipe(
  filter((pubkey): pubkey is string => {
    return pubkey !== null
  }),
  shareReplay(1),
)

const pnsKeysMax$ = new BehaviorSubject<PnsKeys | null>(null)
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

// Track sync statistics
const syncStats1081 = {
  eventsReceived: 0,
  lastSyncTime: null as Date | null,
}

// Combined stream that emits when keys/relays/chatSyncEnabled are ready OR when manually triggered
const syncInputs$ = merge(
  // Initial emission when keys, relays, and chatSyncEnabled are all defined
  combineLatest([pnsKeysDefined$, relayUrlsDefined$, chatSyncEnabled$]),
  // Re-emit current values when sync is manually triggered
  syncTrigger$.pipe(
    switchMap(() => combineLatest([pnsKeysDefined$, relayUrlsDefined$, chatSyncEnabled$]).pipe(
      // Take only the first emission to avoid duplicate syncs
      map(values => values)
    ))
  )
)

// Sync kind 1080 events between eventStore and relays
const syncEvents$ = syncInputs$.pipe(
  switchMap(([pnsKeys, relayUrls, chatSyncEnabled]) => {
    // Reset sync stats for new sync
    syncStats.eventsReceived = 0
    syncStats.lastSyncTime = new Date()

    // Create the kind 1080 filter for this user's PNS events
    const kind1080Filter = {
      kinds: [KIND_PNS],
      authors: [pnsKeys.pnsKeypair.pubKey],
    }

    // Determine sync direction based on chatSyncEnabled setting
    const syncDirection = chatSyncEnabled ? SyncDirection.BOTH : SyncDirection.RECEIVE

    console.log('[useChatSyncProMax] Syncing with relays:', relayUrls, 'Direction:', syncDirection)

    // Use relayPool.sync to synchronize events between eventStore and relays
    // The sync function uses negentropy protocol for efficient synchronization
    return relayPool.sync(relayUrls, eventStore, kind1080Filter, syncDirection).pipe(
      tap((event) => {
        syncStats.eventsReceived++
        console.log('[useChatSyncProMax] Synced event:', event.id, 'Total:', syncStats.eventsReceived, eventStore.hasEvent(event.id))
        eventStore.add(event);
      }),
      // Handle EmptyError when sync completes with no events to sync
      // This happens when there are no events matching the filter on any relay
      catchError((err) => {
        // EmptyError is thrown when firstValueFrom receives no emissions
        if (err.name === 'EmptyError') {
          console.log('[useChatSyncProMax] Sync complete - no events to sync')
          return EMPTY
        }
        // Re-throw other errors
        throw err
      }),
    )
  }),
  shareReplay(1),
)

const sync1081Event$ = combineLatest([userPubkeyDefined$, relayUrlsDefined$]).pipe(
  switchMap(([userPubkey, relayUrls]) => {
    // Reset sync stats for new sync
    syncStats1081.eventsReceived = 0
    syncStats1081.lastSyncTime = new Date()

    // Create the kind 1080 filter for this user's PNS events
    const kind1081Filter = {
      kinds: [1081],
      authors: [userPubkey],
    }
    console.log('[useChatSync1081] Syncing with relays:', relayUrls, 'user.pub', userPubkey)

    // Use relayPool.sync to synchronize events between eventStore and relays
    // The sync function uses negentropy protocol for efficient synchronization
    return relayPool.sync(relayUrls, eventStore, kind1081Filter, SyncDirection.BOTH).pipe(
      tap((event) => {
        syncStats1081.eventsReceived++
        console.log('[useChatSyncProMax] Synced 1081 event:', event.id, 'Total:', syncStats1081.eventsReceived, eventStore.hasEvent(event.id))
        eventStore.add(event);
      }),
      // Handle EmptyError when sync completes with no events to sync
      // This happens when there are no events matching the filter on any relay
      catchError((err) => {
        console.log("some er", err)
        // EmptyError is thrown when firstValueFrom receives no emissions
        if (err.name === 'EmptyError') {
          console.log('[useChatSyncProMax] Sync complete - no events to sync')
          return EMPTY
        }
        // Re-throw other errors
        throw err
      }),
    )
  }),
  shareReplay(1),
)

export function useChatSync1081() {
  const { config } = useAppContext()
  const [syncedEvents, setSyncedEvents] = useState<NostrEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [loading1081, setLoading1081] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPnsKeys, setCurrentPnsKeys] = useState<PnsKeys | null>(null)
  const syncCountRef = useRef(0)
  const syncCount1081Ref = useRef(0)

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
    const sub = sync1081Event$.subscribe({
      next: (event) => {
        if (event) {
          syncCount1081Ref.current++
          console.log("1081 EVNET, ", event);
        }
        setLoading1081(false)
      },
      error: (err) => {
        console.error('[useChatSyncProMax] Sync error:', err)
        setError(err instanceof Error ? err.message : String(err))
        setLoading1081(false)
      },
      complete: () => {
        console.log('[useChatSyncProMax] Sync complete. Total events:', syncCount1081Ref.current)
        setLoading1081(false)
      },
    })

    return () => {
      sub.unsubscribe()
    }
  }, [])

  useEffect(() => {
    console.log('Event sync loading done, ', syncStats1081.lastSyncTime, loading1081)
    console.log('TOKTAL SYNC done, ', syncCount1081Ref.current)
  }, [loading1081])

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