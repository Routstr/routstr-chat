import { useCashuStore } from "@/features/wallet/state/cashuStore";
import { currentOwner } from "@/features/session/owned";
import {
  Mint,
  MintOperationError,
  MintQuoteState,
  OutputData,
  Wallet,
  type MintPreview,
  type MintQuoteResponse,
  type Keyset,
  type MintKeyset,
  type Proof,
  type SerializedBlindedMessage,
} from "@cashu/cashu-ts";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

const PREVIEW_STORAGE_PREFIX = "cashu_mint_preview_v1";

interface StoredOutputData {
  blindedMessage: SerializedBlindedMessage;
  blindingFactor: string;
  secret: number[];
}

interface StoredMintPreview {
  mintUrl: string;
  amount: number;
  createdAt: number;
  method: string;
  payload: MintPreview["payload"];
  outputData: StoredOutputData[];
  keysetId: string;
  quote: string;
}

const activeClaims = new Map<string, Promise<Proof[]>>();

export class MintRecoveryUnavailableError extends Error {
  constructor() {
    super("Mint quote was issued without locally recoverable output data");
    this.name = "MintRecoveryUnavailableError";
  }
}

function normalizeMintUrl(mintUrl: string): string {
  return mintUrl.replace(/\/+$/, "");
}

function claimKey(mintUrl: string, quoteId: string): string {
  return `${normalizeMintUrl(mintUrl)}:${quoteId}`;
}

function getPreviewStorage(): Storage {
  if (typeof window === "undefined") {
    throw new Error("Mint recovery requires browser storage");
  }
  return window.localStorage;
}

function previewStorageKey(mintUrl: string, quoteId: string): string {
  return `${PREVIEW_STORAGE_PREFIX}:${encodeURIComponent(
    normalizeMintUrl(mintUrl)
  )}:${encodeURIComponent(quoteId)}`;
}

function savePreview(
  mintUrl: string,
  amount: number,
  preview: MintPreview
): void {
  const normalizedMintUrl = normalizeMintUrl(mintUrl);
  const storedPreview: StoredMintPreview = {
    mintUrl: normalizedMintUrl,
    amount,
    createdAt: Date.now(),
    method: preview.method,
    payload: preview.payload,
    outputData: preview.outputData.map((output) => ({
      blindedMessage: output.blindedMessage,
      blindingFactor: output.blindingFactor.toString(),
      secret: Array.from(output.secret),
    })),
    keysetId: preview.keysetId,
    quote: preview.quote,
  };
  getPreviewStorage().setItem(
    previewStorageKey(normalizedMintUrl, preview.quote),
    JSON.stringify(storedPreview)
  );
}

function deletePreview(mintUrl: string, quoteId: string): void {
  getPreviewStorage().removeItem(previewStorageKey(mintUrl, quoteId));
}

function loadPreview(
  mintUrl: string,
  quoteId: string,
  amount: number
): MintPreview | null {
  const normalizedMintUrl = normalizeMintUrl(mintUrl);
  const storedValue = getPreviewStorage().getItem(
    previewStorageKey(normalizedMintUrl, quoteId)
  );
  if (!storedValue) return null;
  const stored = JSON.parse(storedValue) as StoredMintPreview;

  if (stored.mintUrl !== normalizedMintUrl || stored.quote !== quoteId) {
    throw new Error("Stored mint recovery data does not match this quote");
  }

  const validOutput = stored.outputData.every((output, index) => {
    const payloadOutput = stored.payload.outputs[index];
    return (
      payloadOutput &&
      output.blindedMessage.B_ === payloadOutput.B_ &&
      output.blindedMessage.id === payloadOutput.id &&
      output.blindedMessage.amount === payloadOutput.amount &&
      output.secret.every(
        (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255
      )
    );
  });
  const outputAmount = stored.outputData.reduce(
    (total, output) => total + output.blindedMessage.amount,
    0
  );

  if (
    stored.amount !== amount ||
    stored.method !== "bolt11" ||
    stored.payload.quote !== quoteId ||
    stored.payload.outputs.length !== stored.outputData.length ||
    stored.outputData.length === 0 ||
    outputAmount !== amount ||
    !validOutput
  ) {
    throw new Error("Stored mint recovery data does not match this quote");
  }

  return {
    method: stored.method,
    payload: stored.payload,
    outputData: stored.outputData.map(
      (output) =>
        new OutputData(
          output.blindedMessage,
          BigInt(output.blindingFactor),
          Uint8Array.from(output.secret)
        )
    ),
    keysetId: stored.keysetId,
    quote: stored.quote,
  };
}

function isKeysetRejection(error: unknown): error is MintOperationError {
  return (
    error instanceof MintOperationError &&
    (error.code === 12001 || error.code === 12002 || error.code === 12003)
  );
}

async function waitForPaidQuote(
  mint: Mint,
  quoteId: string,
  maxAttempts: number
): Promise<MintQuoteResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const quote = await mint.checkMintQuoteBolt11(quoteId);
      if (
        quote.state === MintQuoteState.PAID ||
        quote.state === MintQuoteState.ISSUED
      ) {
        return quote;
      }
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }

    if (attempt + 1 < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  if (lastError) throw lastError;
  throw new Error("Invoice has not been paid yet");
}

async function loadWallet(
  mintUrl: string,
  unit: string,
  keysetId?: string
): Promise<Wallet> {
  const wallet = new Wallet(new Mint(mintUrl), { unit });
  await wallet.loadMint(true);
  if (keysetId) {
    await wallet.keyChain.ensureKeysetKeys(keysetId);
  }
  return wallet;
}

async function restorePreview(
  wallet: Wallet,
  preview: MintPreview
): Promise<Proof[]> {
  const restored = await wallet.mint.restore({
    outputs: preview.payload.outputs,
  });
  const signatures = new Map(
    restored.outputs.map((output, index) => [
      output.B_,
      restored.signatures[index],
    ])
  );
  const keyset = wallet.getKeyset(preview.keysetId);
  const proofs = preview.outputData.map((output) => {
    const signature = signatures.get(output.blindedMessage.B_);
    if (!signature) {
      throw new Error("Mint did not return every recoverable signature");
    }
    return output.toProof(signature, keyset);
  });

  return proofs;
}

/** The wallet copy of the account a claim began for: it settles there. */
type WalletCopy = ReturnType<typeof useCashuStore.of>;

function persistProofs(store: WalletCopy, proofs: Proof[]): void {
  const cashuStore = store.getState();
  const provisionalEventId = bytesToHex(randomBytes(32));
  cashuStore.addProofs(proofs, provisionalEventId);

  const persistedSecrets = new Set(
    store.getState().proofs.map((proof) => proof.secret)
  );
  if (!proofs.every((proof) => persistedSecrets.has(proof.secret))) {
    throw new Error("Minted proofs could not be saved locally");
  }
}

type StoredKeyset = {
  id?: string;
  unit?: string;
  active?: boolean;
  input_fee_ppk?: number;
  final_expiry?: number;
  _id?: string;
  _unit?: string;
  _active?: boolean;
  _input_fee_ppk?: number;
  _final_expiry?: number;
  toMintKeyset?: () => MintKeyset;
};

function serializeKeyset(keyset: StoredKeyset): MintKeyset {
  if (typeof keyset.toMintKeyset === "function") {
    return keyset.toMintKeyset();
  }

  const id = keyset.id ?? keyset._id;
  const unit = keyset.unit ?? keyset._unit;
  const active = keyset.active ?? keyset._active;
  if (!id || !unit || typeof active !== "boolean") {
    throw new Error("Stored mint keyset metadata is invalid");
  }

  return {
    id,
    unit,
    active,
    input_fee_ppk: keyset.input_fee_ppk ?? keyset._input_fee_ppk ?? 0,
    final_expiry: keyset.final_expiry ?? keyset._final_expiry,
  };
}

function persistMintKeysets(
  store: WalletCopy,
  mintUrl: string,
  wallet: Wallet,
  proofs: Proof[]
): string {
  const cashuStore = store.getState();
  const existingMint =
    cashuStore.getMint(mintUrl) ??
    cashuStore.mints.find(
      (mint) => normalizeMintUrl(mint.url) === normalizeMintUrl(mintUrl)
    );
  const storageMintUrl = existingMint?.url ?? mintUrl;
  const keysetsById = new Map(
    (existingMint?.keysets ?? []).map((keyset) => {
      const serialized = serializeKeyset(keyset as unknown as StoredKeyset);
      return [serialized.id, serialized];
    })
  );

  wallet.keyChain.getKeysets().forEach((keyset) => {
    const serialized = keyset.toMintKeyset();
    keysetsById.set(serialized.id, serialized);
  });

  if (!existingMint) cashuStore.addMint(storageMintUrl);
  store
    .getState()
    .setKeysets(storageMintUrl, [
      ...keysetsById.values(),
    ] as unknown as Keyset[]);

  const storedKeysetIds = new Set(
    (store.getState().getMint(storageMintUrl)?.keysets ?? []).map(
      (keyset) => serializeKeyset(keyset as unknown as StoredKeyset).id
    )
  );
  if (!proofs.every((proof) => storedKeysetIds.has(proof.id))) {
    throw new Error("Mint keysets could not be saved locally");
  }

  return storageMintUrl;
}

async function completePreparedMint(
  wallet: Wallet,
  preview: MintPreview,
  quoteState: MintQuoteResponse["state"]
): Promise<Proof[]> {
  try {
    return await wallet.completeMint(preview);
  } catch (error) {
    if (quoteState !== MintQuoteState.ISSUED) throw error;
    return restorePreview(wallet, preview);
  }
}

async function settlePaidQuoteLocked(
  store: WalletCopy,
  normalizedMintUrl: string,
  quoteId: string,
  amount: number,
  quote: MintQuoteResponse
): Promise<Proof[]> {
  const quoteAmount = quote.amount || amount;

  if (quoteAmount !== amount) {
    throw new Error("Stored invoice amount does not match the mint quote");
  }

  const unit = quote.unit || "sat";
  let preview = loadPreview(normalizedMintUrl, quoteId, quoteAmount);

  if (quote.state === MintQuoteState.ISSUED && !preview) {
    throw new MintRecoveryUnavailableError();
  }

  let wallet = await loadWallet(normalizedMintUrl, unit, preview?.keysetId);

  if (!preview) {
    preview = await wallet.prepareMint("bolt11", quoteAmount, quoteId, {
      keysetId: wallet.keysetId,
    });
    savePreview(normalizedMintUrl, quoteAmount, preview);
  }

  let proofs: Proof[];
  try {
    proofs = await completePreparedMint(wallet, preview, quote.state);
  } catch (error) {
    if (!isKeysetRejection(error) || quote.state !== MintQuoteState.PAID) {
      throw error;
    }

    deletePreview(normalizedMintUrl, quoteId);
    wallet = await loadWallet(normalizedMintUrl, unit);
    preview = await wallet.prepareMint("bolt11", quoteAmount, quoteId, {
      keysetId: wallet.keysetId,
    });
    savePreview(normalizedMintUrl, quoteAmount, preview);

    try {
      proofs = await wallet.completeMint(preview);
    } catch (retryError) {
      if (isKeysetRejection(retryError)) {
        deletePreview(normalizedMintUrl, quoteId);
      }
      throw retryError;
    }
  }

  const storageMintUrl = persistMintKeysets(
    store,
    normalizedMintUrl,
    wallet,
    proofs
  );
  persistProofs(store, proofs);
  store.getState().updateMintQuote(storageMintUrl, quoteId, {
    ...quote,
    state: MintQuoteState.ISSUED,
  });
  return proofs;
}

async function withSettlementLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("cashu-mint-settlement", operation);
  }
  return operation();
}

async function claimPaidQuote(
  store: WalletCopy,
  mintUrl: string,
  quoteId: string,
  amount: number,
  maxAttempts: number
): Promise<Proof[]> {
  const normalizedMintUrl = normalizeMintUrl(mintUrl);
  await waitForPaidQuote(new Mint(normalizedMintUrl), quoteId, maxAttempts);

  return withSettlementLock(async () => {
    await store.persist.rehydrate();
    const quote = await waitForPaidQuote(
      new Mint(normalizedMintUrl),
      quoteId,
      1
    );
    return settlePaidQuoteLocked(
      store,
      normalizedMintUrl,
      quoteId,
      amount,
      quote
    );
  });
}

/** The coins go to `owner`, the account the invoice was made for, even if
 *  another account is active by the time it is paid. A guest's invoice
 *  (`null`) goes to the key that took the guest over, if one did. */
export function claimPaidMintQuote(
  mintUrl: string,
  quoteId: string,
  amount: number,
  maxAttempts = 40,
  owner: string | null = null
): Promise<Proof[]> {
  const key = claimKey(mintUrl, quoteId);
  const existing = activeClaims.get(key);
  if (existing) return existing;

  const operation = claimPaidQuote(
    useCashuStore.of(owner ?? currentOwner()),
    mintUrl,
    quoteId,
    amount,
    maxAttempts
  );
  activeClaims.set(key, operation);
  operation.then(undefined, () => {
    if (activeClaims.get(key) === operation) activeClaims.delete(key);
  });
  return operation;
}

export function finalizeMintClaim(mintUrl: string, quoteId: string): void {
  const key = claimKey(mintUrl, quoteId);
  try {
    deletePreview(mintUrl, quoteId);
  } catch (error) {
    console.error("Failed to clear completed mint recovery data:", error);
  } finally {
    activeClaims.delete(key);
  }
}
