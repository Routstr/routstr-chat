"use client";

import {
  CONFIG_TYPES,
  configSyncEose$,
  publishConfig,
  relayUrls$,
  sdkApiKeysResult$,
  userSigner$,
} from "@/hooks/sync";
import type { SyncedApiKey } from "@/hooks/sync/configRegistry";
import { acquirePaymentLock } from "@/sdk/paymentRequest";
import { getPaymentStore } from "@/sdk/paymentStore";
import type { ApiKeyEntry } from "@routstr/sdk/wallet";
import { useObservableState } from "applesauce-react/hooks";
import { useEffect, useRef } from "react";
import { create } from "zustand";

/**
 * Keys this account's other devices hold. Each device publishes only its own
 * entries; two publishing at once may drop each other's newest until the next
 * publish. The Refund button refunds these, recovering a lost device's credit.
 */
export const otherDeviceKeys = create<{
  owner: string | null;
  keys: SyncedApiKey[];
}>(() => ({ owner: null, keys: [] }));

const DEVICE_ID_KEY = "routstr-chat-device-id";

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

const keySet = (keys: Array<ApiKeyEntry & { device?: string }>) =>
  keys
    .map((k) => `${k.device} ${k.baseUrl} ${k.key}`)
    .sort()
    .join("\n");

/**
 * Backs up this device's provider keys, encrypted, on the account's relays and
 * restores lost ones. Publishes only when a key is added or removed.
 */
export function useSdkApiKeysSync() {
  const signerInfo = useObservableState(userSigner$);
  const relayUrls = useObservableState(relayUrls$) ?? [];
  const remote = useObservableState(sdkApiKeysResult$);
  const eose = useObservableState(configSyncEose$);
  const owner = signerInfo?.pubkey;

  // The key list last seen on the relays; null until they answered, so an
  // empty first read can't wipe other devices' entries.
  const publishedRef = useRef<string | null>(null);
  const publishRef = useRef<() => Promise<void>>(async () => {});
  // Keys that left the store this session; the relays may still list them.
  const removedRef = useRef(new Set<string>());

  publishRef.current = async () => {
    if (!signerInfo || !owner || relayUrls.length === 0) return;
    if (publishedRef.current === null) return;
    const me = deviceId();
    const keys = [
      ...otherDeviceKeys.getState().keys,
      ...getPaymentStore(owner)
        .store.getState()
        .apiKeys.map((key) => ({ ...key, device: me })),
    ];
    if (keySet(keys) === publishedRef.current) return;
    try {
      await publishConfig(
        CONFIG_TYPES.SDK_API_KEYS,
        keys,
        signerInfo,
        relayUrls
      );
      publishedRef.current = keySet(keys);
    } catch (error) {
      console.error("[useSdkApiKeysSync] Failed to publish keys:", error);
    }
  };

  useEffect(() => {
    publishedRef.current = null;
    removedRef.current = new Set();
    otherDeviceKeys.setState({ owner: owner ?? null, keys: [] });
    if (!owner) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void publishRef.current(), 500);
    };
    const unsubscribeLocal = getPaymentStore(owner).store.subscribe(
      (state, previous) => {
        if (keySet(state.apiKeys) === keySet(previous.apiKeys)) return;
        const kept = new Set(state.apiKeys.map((k) => k.key));
        for (const k of previous.apiKeys) {
          if (!kept.has(k.key)) removedRef.current.add(k.key);
        }
        schedule();
      }
    );
    // The Refund button removes other devices' keys it refunded.
    const unsubscribeOthers = otherDeviceKeys.subscribe(schedule);
    return () => {
      unsubscribeLocal();
      unsubscribeOthers();
      clearTimeout(timer);
    };
  }, [owner]);

  useEffect(() => {
    if (!owner || !eose || !remote || remote.status === "error") return;
    if (remote.status === "ok" && remote.event.pubkey !== owner) return;
    let cancelled = false;

    const apply = async () => {
      const me = deviceId();
      const mine = remote.value.filter((key) => key.device === me);
      const payments = getPaymentStore(owner);
      // A request in another tab writes the whole key list when it finishes,
      // so restore under the payment lock or that write drops the restore.
      const release = await acquirePaymentLock(owner);
      try {
        await payments.reload();
        if (cancelled) return;
        // Restore lost keys; a different key at that provider replaced it.
        for (const key of mine) {
          if (removedRef.current.has(key.key)) continue;
          if (payments.storage.getApiKey(key.baseUrl)) continue;
          payments.storage.setApiKey(key.baseUrl, key.key);
          payments.storage.updateApiKeyBalance(key.baseUrl, key.balance);
        }
        await payments.storage.flush?.();
      } finally {
        release();
      }
      if (cancelled) return;
      publishedRef.current = keySet(remote.value);
      otherDeviceKeys.setState({
        owner,
        keys: remote.value.filter((key) => key.device !== me),
      });
      await publishRef.current();
    };

    apply().catch((error) => {
      console.error("[useSdkApiKeysSync] Failed to apply keys:", error);
    });
    return () => {
      cancelled = true;
    };
  }, [owner, eose, remote]);
}
