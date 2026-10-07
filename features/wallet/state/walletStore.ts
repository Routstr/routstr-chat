import type { GetInfoResponse, Keyset, MintKeys } from "@cashu/cashu-ts";
import { createJSONStorage, persist } from "zustand/middleware";
import { ownedStore } from "@/features/session/owned";

/** A mint the wallet knows: its info and keysets, as the mint answered. */
export interface WalletMint {
  url: string;
  mintInfo?: GetInfoResponse;
  keysets?: Keyset[];
  keys?: Record<string, MintKeys>[];
  lastUpdate?: number;
}

/** One account's mints, the one it pays from, and its NIP-60 wallet key. */
export interface WalletStore {
  mints: WalletMint[];
  activeMintUrl?: string;
  /** the active mint, when the person picked it themselves */
  userSelectedMintUrl?: string;
  privkey?: string;

  addMint: (url: string) => void;
  getMint: (url: string) => WalletMint | undefined;
  clearMint: (url: string) => void;
  setMintInfo: (url: string, mintInfo: GetInfoResponse) => void;
  setKeysets: (url: string, keysets: Keyset[]) => void;
  setKeys: (url: string, keys: Record<string, MintKeys>[]) => void;
  setLastUpdate: (url: string, lastUpdate: number) => void;
  getLastUpdate: (url: string) => number;
  setActiveMintUrl: (url: string) => void;
  setActiveMintUrlByUser: (url: string) => void;
  clearUserSelectedMint: () => void;
  getActiveMintUrl: () => string | undefined;
  setPrivkey: (privkey: string) => void;
}

const NAME = "wallet-mints";
// main's per-account blob ("cashu:<pubkey>", or "cashu" before accounts)
const OLD = "cashu";

type Saved = Pick<
  WalletStore,
  "mints" | "activeMintUrl" | "userSelectedMintUrl" | "privkey"
>;

/** This store's own copy; until it has one, what main's old blob says of the
 *  mints, read once and never written (main still uses it on this origin). */
export function walletStorage(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
) {
  return {
    getItem(name: string): string | null {
      const saved = storage.getItem(name);
      if (saved !== null) return saved;
      const old = storage.getItem(OLD + name.slice(NAME.length));
      if (!old) return null;
      try {
        const state = JSON.parse(old)?.state ?? {};
        const from: Saved = {
          mints: (state.mints ?? []).map(
            ({ url, mintInfo, keysets, keys, lastUpdate }: WalletMint) => ({
              url,
              mintInfo,
              keysets,
              keys,
              lastUpdate,
            })
          ),
          activeMintUrl: state.activeMintUrl,
          userSelectedMintUrl: state.userSelectedMintUrl,
          privkey: state.privkey,
        };
        return JSON.stringify({ state: from, version: 0 });
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string) => storage.setItem(name, value),
    removeItem: (name: string) => storage.removeItem(name),
  };
}

const each = (
  mints: WalletMint[],
  url: string,
  change: (mint: WalletMint) => WalletMint
) => mints.map((mint) => (mint.url === url ? change(mint) : mint));

export const useWalletStore = ownedStore<WalletStore>()(
  persist(
    (set, get) => ({
      mints: [],

      addMint(url) {
        if (get().mints.some((mint) => mint.url === url)) return;
        // the first mint is the one it pays from
        set({
          mints: [...get().mints, { url }],
          ...(get().mints.length === 0 ? { activeMintUrl: url } : {}),
        });
      },
      getMint: (url) => get().mints.find((mint) => mint.url === url),
      clearMint(url) {
        set({
          mints: each(get().mints, url, (mint) => ({
            ...mint,
            keysets: undefined,
            keys: undefined,
          })),
        });
      },
      setMintInfo(url, mintInfo) {
        set({
          mints: each(get().mints, url, (mint) => ({ ...mint, mintInfo })),
        });
      },
      setKeysets(url, keysets) {
        set({
          mints: each(get().mints, url, (mint) => ({ ...mint, keysets })),
        });
      },
      setKeys(url, keys) {
        set({ mints: each(get().mints, url, (mint) => ({ ...mint, keys })) });
      },
      setLastUpdate(url, lastUpdate) {
        set({
          mints: each(get().mints, url, (mint) => ({ ...mint, lastUpdate })),
        });
      },
      getLastUpdate: (url) => get().getMint(url)?.lastUpdate ?? 0,
      setActiveMintUrl(url) {
        set({ activeMintUrl: url });
      },
      setActiveMintUrlByUser(url) {
        set({ activeMintUrl: url, userSelectedMintUrl: url });
      },
      clearUserSelectedMint() {
        set({ userSelectedMintUrl: undefined });
      },
      getActiveMintUrl: () => get().activeMintUrl,
      setPrivkey(privkey) {
        set({ privkey });
      },
    }),
    {
      name: NAME,
      storage: createJSONStorage(() => walletStorage(window.localStorage)),
      partialize: ({ mints, activeMintUrl, userSelectedMintUrl, privkey }) =>
        ({ mints, activeMintUrl, userSelectedMintUrl, privkey }) as WalletStore,
      // each copy loads only under its owner's name (ownedStore)
      skipHydration: true,
    }
  )
);
