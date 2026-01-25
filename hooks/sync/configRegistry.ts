/**
 * Config Registry - Type definitions for syncable configuration types
 *
 * This registry defines all config types that can be synced via Nostr.
 * Adding a new config type is as simple as adding an entry here.
 */

import { KINDS } from "@/lib/nostr-kinds";
import type { StoredApiKey } from "@/components/settings/ApiKeysTab";
import type { StoredInvoice } from "@/hooks/useInvoiceSync";

/**
 * Definition for a syncable config type
 */
export interface ConfigTypeDefinition<T = unknown> {
  /** Unique identifier for this config type */
  id: string;
  /** Nostr event kind */
  kind: number;
  /** The d tag value for replaceable events (NIP-78) */
  dTag: string;
  /** Whether content is NIP-44 encrypted */
  encrypted: boolean;
  /** Parse/validate the decrypted content */
  parseContent: (data: unknown) => T | null;
  /** Default value when no event exists */
  defaultValue: T;
}

/**
 * Helper to create a type-safe config definition
 */
function defineConfig<T>(config: ConfigTypeDefinition<T>): ConfigTypeDefinition<T> {
  return config;
}

/**
 * All syncable config types
 *
 * To add a new config type:
 * 1. Define its TypeScript interface
 * 2. Add an entry here with kind, dTag, and parser
 * 3. The system will automatically include it in the unified subscription
 */
export const CONFIG_TYPES = {
  API_KEYS: defineConfig<StoredApiKey[]>({
    id: "api-keys",
    kind: KINDS.ARBITRARY_APP_DATA, // 30078
    dTag: "routstr-chat-api-keys-v1",
    encrypted: true,
    parseContent: (data: unknown): StoredApiKey[] | null => {
      if (!Array.isArray(data)) return null;
      // Basic validation - ensure each item has required fields
      const valid = data.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "key" in item &&
          typeof item.key === "string"
      );
      return valid ? (data as StoredApiKey[]) : null;
    },
    defaultValue: [],
  }),

  INVOICES: defineConfig<StoredInvoice[]>({
    id: "invoices",
    kind: KINDS.ARBITRARY_APP_DATA, // 30078
    dTag: "routstr-chat-invoices-v1",
    encrypted: true,
    parseContent: (data: unknown): StoredInvoice[] | null => {
      if (!Array.isArray(data)) return null;
      // Basic validation - ensure each item has required fields
      const valid = data.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "id" in item &&
          "type" in item &&
          "quoteId" in item
      );
      return valid ? (data as StoredInvoice[]) : null;
    },
    defaultValue: [],
  }),
} as const;

/**
 * Type helper to extract the data type from a config definition
 */
export type ConfigDataType<T extends ConfigTypeDefinition> =
  T extends ConfigTypeDefinition<infer U> ? U : never;

/**
 * Union type of all config type IDs
 */
export type ConfigTypeId = (typeof CONFIG_TYPES)[keyof typeof CONFIG_TYPES]["id"];

/**
 * Get all config definitions as an array
 */
export function getAllConfigTypes(): ConfigTypeDefinition[] {
  return Object.values(CONFIG_TYPES);
}

/**
 * Get a config definition by its ID
 */
export function getConfigTypeById(id: string): ConfigTypeDefinition | undefined {
  return getAllConfigTypes().find((config) => config.id === id);
}

/**
 * Get a config definition by kind and dTag
 */
export function getConfigTypeByKindAndDTag(
  kind: number,
  dTag: string
): ConfigTypeDefinition | undefined {
  return getAllConfigTypes().find(
    (config) => config.kind === kind && config.dTag === dTag
  );
}
