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

// Tagged non-replaceable sync (kind 1018 + #e)
export {
  KIND_1018,
  KIND_0,
  type Kind0Profile,
  kind1018ETag$,
  updateKind1018ETag,
  kind1018ETagDefined$,
  kind1018SyncEose$,
  kind1018EventReceived$,
  kind1018TrustScores$,
  kind1018Sync$,
  getKind1018Events,
  kind1018Events$,
  kind0SyncEose$,
  kind0EventReceived$,
  kind0Sync$,
  kind0Profiles$,
} from "./taggedEventSync";

// Publishing helpers
export { publishConfig, deleteConfig, canPublish } from "./configPublish";

// Decrypted config observables
export {
  createConfigObservable,
  configOwner,
  activeConfigPubkey$,
  apiKeys$,
  invoices$,
  theme$,
  configSyncLoading$,
  configSyncReady$,
} from "./configObservables";

// Re-export shared inputs (from chatSyncInputs)
export {
  relayUrls$,
  relayUrlsDefined$,
  userPubkey$,
  userPubkeyDefined$,
  wotPubkey$,
  wotPubkeyDefined$,
  userSigner$,
  userSignerDefined$,
  chatSyncEnabled$,
  updateChatSyncEnabled,
  updateWotPubkey,
  type UserSignerInfo,
} from "./chatSyncInputs";

// Existing sync modules (for backwards compatibility)
export {
  sync1081Event$,
  derivedPnsKeys$,
  derivedPnsPubkeys$,
} from "./sync1081Keyring";
