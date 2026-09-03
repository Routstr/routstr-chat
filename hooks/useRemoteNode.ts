"use client";

import { useSyncExternalStore } from "react";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/components/ClientProviders";
import {
  loadRemoteNode,
  REMOTE_NODE_CHANGED,
  STORAGE_KEYS,
  type RemoteNode,
} from "@/utils/storageUtils";

const subscribe = (onChange: () => void) => {
  window.addEventListener(REMOTE_NODE_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(REMOTE_NODE_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
};

let cached: RemoteNode | null = null;
let cachedRaw: string | null = null;

// useSyncExternalStore needs a stable reference, so only re-parse when the raw
// string changed.
const getSnapshot = (): RemoteNode | null => {
  const raw = localStorage.getItem(STORAGE_KEYS.REMOTE_NODE);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = loadRemoteNode();
  }
  return cached;
};

/** The connected node when it is set to pay for the signed-in account. */
export function useNodePays(): RemoteNode | null {
  const node = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  if (!node?.enabled || !node.apiKey) return null;
  // The key is issued to one npub, so another account has to get its own.
  return node.pubkey === active?.pubkey ? node : null;
}
