"use client";

const IDENTITY_PREFIX = "identity";

const DEVICE_GLOBAL_STORAGE_KEYS = new Set<string>([
  "accounts",
  "activeAccount",
  "sidebar_open",
  "sidebar_collapsed",
  "topup_prompt_seen",
  "created_ephemeral_nsec",
  "modelsFromAllProviders",
  "mints_from_all_providers",
  "info_from_all_providers",
  "lastModelsUpdate",
  "cashu_relays_timeout",
  "anonymous_wallet_recovery_owner",
  "anonymous_wallet_recovery_source",
]);

let currentIdentityId: string | null = null;
let hasBootstrappedIdentity = false;

const identitySubscribers = new Set<() => void>();
const ANONYMOUS_RECOVERY_OWNER_KEY = "anonymous_wallet_recovery_owner";
const ANONYMOUS_RECOVERY_SOURCE_KEY = "anonymous_wallet_recovery_source";
const ANONYMOUS_RECOVERY_KEYS = [
  "cashu",
  "cashu-history",
  "lightning_invoices",
  "transaction_history",
  "local_cashu_tokens",
  "usingNip60",
] as const;

const bootstrapIdentityId = (): string | null => {
  if (hasBootstrappedIdentity) {
    return currentIdentityId;
  }

  hasBootstrappedIdentity = true;

  if (typeof window === "undefined") {
    return currentIdentityId;
  }

  try {
    const activeAccountId = window.localStorage.getItem("activeAccount");
    const rawAccounts = window.localStorage.getItem("accounts");
    if (!rawAccounts) {
      return currentIdentityId;
    }

    const accounts = JSON.parse(rawAccounts) as Array<{
      id?: string;
      pubkey?: string;
    }>;

    if (activeAccountId) {
      const activeAccount = accounts.find(
        (account) => account.id === activeAccountId
      );
      currentIdentityId = activeAccount?.pubkey ?? null;
      return currentIdentityId;
    }

    currentIdentityId = accounts[0]?.pubkey ?? null;
    return currentIdentityId;
  } catch {
    currentIdentityId = null;
    return currentIdentityId;
  }
};

export const getCurrentIdentityId = (): string | null => {
  return bootstrapIdentityId();
};

export const setCurrentIdentityId = (identityId: string | null): void => {
  hasBootstrappedIdentity = true;
  if (currentIdentityId === identityId) return;
  currentIdentityId = identityId;
  identitySubscribers.forEach((listener) => listener());
};

export const subscribeToIdentityScope = (
  listener: () => void
): (() => void) => {
  identitySubscribers.add(listener);
  return () => {
    identitySubscribers.delete(listener);
  };
};

export const shouldScopeStorageKey = (key: string): boolean => {
  return Boolean(key) && !DEVICE_GLOBAL_STORAGE_KEYS.has(key);
};

export const getScopedStorageKey = (
  key: string,
  identityId?: string | null
): string => {
  const scopedIdentityId =
    identityId === undefined ? getCurrentIdentityId() : identityId;

  if (!scopedIdentityId || !shouldScopeStorageKey(key)) {
    return key;
  }

  return `${IDENTITY_PREFIX}:${scopedIdentityId}:${key}`;
};

export const getScopedDbName = (
  dbName: string,
  identityId?: string | null
): string => {
  const scopedIdentityId =
    identityId === undefined ? getCurrentIdentityId() : identityId;

  if (!scopedIdentityId) {
    return dbName;
  }

  return `${dbName}-${IDENTITY_PREFIX}-${scopedIdentityId}`;
};

const hasArrayEntries = (rawValue: string | null, field?: string): boolean => {
  if (!rawValue) return false;

  try {
    const parsed = JSON.parse(rawValue);
    const value = field ? parsed?.[field] : parsed;
    return Array.isArray(value) && value.length > 0;
  } catch {
    return false;
  }
};

const hasCashuProofs = (rawValue: string | null): boolean => {
  if (!rawValue) return false;

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed?.state?.proofs) && parsed.state.proofs.length > 0;
  } catch {
    return false;
  }
};

const shouldRecoverAnonymousKey = (
  key: (typeof ANONYMOUS_RECOVERY_KEYS)[number],
  sourceValue: string | null,
  destinationValue: string | null
): boolean => {
  switch (key) {
    case "cashu":
      return hasCashuProofs(sourceValue) && !hasCashuProofs(destinationValue);
    case "lightning_invoices":
      return hasArrayEntries(sourceValue, "invoices") &&
        !hasArrayEntries(destinationValue, "invoices");
    case "transaction_history":
    case "local_cashu_tokens":
      return hasArrayEntries(sourceValue) && !hasArrayEntries(destinationValue);
    case "usingNip60":
      return destinationValue === null && sourceValue !== null;
    default:
      return false;
  }
};

const hasHistoryEntries = (rawValue: string | null): boolean => {
  if (!rawValue) return false;

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed?.state?.history) && parsed.state.history.length > 0;
  } catch {
    return false;
  }
};

const getAnonymousWalletSourceSignature = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem("cashu");
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    const proofs = Array.isArray(parsed?.state?.proofs) ? parsed.state.proofs : [];
    const total = proofs.reduce(
      (sum: number, proof: { amount?: number }) => sum + (proof.amount || 0),
      0
    );
    return `${proofs.length}:${total}:${parsed?.state?.activeMintUrl ?? ""}`;
  } catch {
    return `${rawValue.length}`;
  }
};

const shouldRecoverKey = (
  key: (typeof ANONYMOUS_RECOVERY_KEYS)[number],
  sourceValue: string | null,
  destinationValue: string | null
): boolean => {
  if (!sourceValue) return false;

  switch (key) {
    case "cashu-history":
      return hasHistoryEntries(sourceValue) && !hasHistoryEntries(destinationValue);
    default:
      return shouldRecoverAnonymousKey(key, sourceValue, destinationValue);
  }
};

export const recoverAnonymousIdentityStorage = (
  identityId: string | null
): { copiedKeys: string[] } => {
  if (!identityId || typeof window === "undefined") {
    return { copiedKeys: [] };
  }

  const sourceSignature = getAnonymousWalletSourceSignature();
  const existingOwner = window.localStorage.getItem(ANONYMOUS_RECOVERY_OWNER_KEY);
  const existingSource = window.localStorage.getItem(ANONYMOUS_RECOVERY_SOURCE_KEY);

  if (
    sourceSignature &&
    existingOwner &&
    existingOwner !== identityId &&
    existingSource === sourceSignature
  ) {
    return { copiedKeys: [] };
  }

  const copiedKeys: string[] = [];

  for (const key of ANONYMOUS_RECOVERY_KEYS) {
    const sourceValue = window.localStorage.getItem(key);
    const destinationKey = getScopedStorageKey(key, identityId);

    if (destinationKey === key) {
      continue;
    }

    const destinationValue = window.localStorage.getItem(destinationKey);
    if (!shouldRecoverKey(key, sourceValue, destinationValue)) {
      continue;
    }

    window.localStorage.setItem(destinationKey, sourceValue as string);
    copiedKeys.push(key);
  }

  const pendingProofKeys = Object.keys(window.localStorage).filter((key) =>
    key.startsWith("pending_send_proofs_")
  );

  for (const key of pendingProofKeys) {
    const destinationKey = getScopedStorageKey(key, identityId);
    if (
      destinationKey !== key &&
      window.localStorage.getItem(destinationKey) === null
    ) {
      const sourceValue = window.localStorage.getItem(key);
      if (!sourceValue) continue;
      window.localStorage.setItem(destinationKey, sourceValue);
      copiedKeys.push(key);
    }
  }

  if (copiedKeys.length > 0) {
    window.localStorage.setItem(ANONYMOUS_RECOVERY_OWNER_KEY, identityId);
    if (sourceSignature) {
      window.localStorage.setItem(ANONYMOUS_RECOVERY_SOURCE_KEY, sourceSignature);
    }
  }

  return { copiedKeys };
};
