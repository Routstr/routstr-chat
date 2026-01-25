/**
 * Config Publish - Helper functions for publishing config events to Nostr
 *
 * Handles NIP-44 encryption and NIP-78 replaceable event creation.
 */

import type { NostrEvent } from "nostr-tools";
import { eventStore, relayPool } from "@/lib/applesauce-core";
import type { ConfigTypeDefinition } from "./configRegistry";
import type { UserSignerInfo } from "./chatSyncInputs";

// Debug toggle
const DEBUG = false;
const log = (...args: unknown[]) =>
  DEBUG && console.log("[configPublish]", ...args);

/**
 * Publish a config to Nostr
 *
 * @param configDef - The config type definition
 * @param data - The data to publish
 * @param signerInfo - User's signer info for signing/encrypting
 * @param relayUrls - Relay URLs to publish to
 * @returns The published event
 */
export async function publishConfig<T>(
  configDef: ConfigTypeDefinition<T>,
  data: T,
  signerInfo: UserSignerInfo,
  relayUrls: string[]
): Promise<NostrEvent> {
  if (!signerInfo.signer) {
    throw new Error("No signer available");
  }

  let content: string;

  // Encrypt if required
  if (configDef.encrypted) {
    if (!signerInfo.signer.nip44) {
      throw new Error("NIP-44 encryption not supported by signer");
    }

    log("Encrypting content for", configDef.id);
    content = await signerInfo.signer.nip44.encrypt(
      signerInfo.pubkey,
      JSON.stringify(data)
    );
  } else {
    content = JSON.stringify(data);
  }

  // Create the event template
  const eventTemplate = {
    kind: configDef.kind,
    content,
    tags: [["d", configDef.dTag]],
    created_at: Math.floor(Date.now() / 1000),
  };

  log("Signing event for", configDef.id);
  const signedEvent = await signerInfo.signer.signEvent(eventTemplate);

  log("Publishing to", relayUrls.length, "relays");
  await relayPool.publish(relayUrls, signedEvent);

  // Add to local event store immediately
  eventStore.add(signedEvent);

  log("Published event:", signedEvent.id.slice(0, 8));
  return signedEvent;
}

/**
 * Delete a config by publishing an empty/null value
 * For NIP-78 replaceable events, this effectively "clears" the config
 *
 * @param configDef - The config type definition
 * @param signerInfo - User's signer info
 * @param relayUrls - Relay URLs to publish to
 * @returns The published event
 */
export async function deleteConfig<T>(
  configDef: ConfigTypeDefinition<T>,
  signerInfo: UserSignerInfo,
  relayUrls: string[]
): Promise<NostrEvent> {
  // Publish with the default/empty value to effectively "delete"
  return publishConfig(configDef, configDef.defaultValue, signerInfo, relayUrls);
}

/**
 * Check if the user can publish (has required signer capabilities)
 */
export function canPublish(
  signerInfo: UserSignerInfo | null,
  configDef: ConfigTypeDefinition
): boolean {
  if (!signerInfo?.signer?.signEvent) {
    return false;
  }

  // If encrypted, need NIP-44 support
  if (configDef.encrypted && !signerInfo.signer.nip44) {
    return false;
  }

  return true;
}
