import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { NostrEvent } from 'nostr-tools'

export interface NutzapInformationalEvent {
  event: NostrEvent;
  relays: string[];
  mints: Array<{
    url: string;
    units?: string[];
  }>;
  p2pkPubkey: string;
}

interface NutzapStore {
  // Store nutzap informational events by pubkey
  nutzapInfo: Record<string, NutzapInformationalEvent>;

  // Add or update nutzap info for a pubkey
  setNutzapInfo: (pubkey: string, info: NutzapInformationalEvent) => void;

  // Get nutzap info for a pubkey
  getNutzapInfo: (pubkey: string) => NutzapInformationalEvent | undefined;

  // Delete nutzap info for a pubkey
  deleteNutzapInfo: (pubkey: string) => void;
}

export const useNutzapStore = create<NutzapStore>()(
  persist(
    (set, get) => ({
      nutzapInfo: {},

      setNutzapInfo(pubkey, info) {
        set(state => ({
          nutzapInfo: {
            ...state.nutzapInfo,
            [pubkey]: info
          }
        }));
      },

      getNutzapInfo(pubkey) {
        return get().nutzapInfo[pubkey];
      },

      deleteNutzapInfo(pubkey) {
        set(state => {
          const nutzapInfo = { ...state.nutzapInfo };
          delete nutzapInfo[pubkey];
          return { nutzapInfo };
        });
      }
    }),
    { name: 'nutzap' },
  ),
) 