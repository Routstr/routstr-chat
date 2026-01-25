/**
 * Sync utilities barrel export
 *
 * Exports all config sync functionality for use throughout the app.
 */

// Config type definitions and registry
export {
  CONFIG_TYPES,
  getAllConfigTypes,
  getConfigTypeById,
  getConfigTypeByKindAndDTag,
  type ConfigTypeDefinition,
  type ConfigDataType,
  type ConfigTypeId,
} from "./configRegistry";

// Generic config sync core
export {
  genericConfigSync$,
  configSyncStats,
  configSyncEose$,
  configEventReceived$,
  decryptEventContent,
  getConfigEvent,
} from "./genericConfigSync";

// Publishing helpers
export { publishConfig, deleteConfig, canPublish } from "./configPublish";

// Decrypted config observables
export {
  createConfigObservable,
  apiKeys$,
  invoices$,
  configSyncLoading$,
  configSyncReady$,
} from "./configObservables";

// Re-export shared inputs (from chatSyncInputs)
export {
  relayUrls$,
  relayUrlsDefined$,
  userPubkey$,
  userPubkeyDefined$,
  userSigner$,
  userSignerDefined$,
  chatSyncEnabled$,
  updateChatSyncEnabled,
  type UserSignerInfo,
} from "./chatSyncInputs";

// Existing sync modules (for backwards compatibility)
export { sync1081Event$, derivedPnsKeys$, derivedPnsPubkeys$ } from "./sync1081Keyring";
