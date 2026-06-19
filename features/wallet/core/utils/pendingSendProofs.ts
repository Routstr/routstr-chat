import type { Proof } from "@cashu/cashu-ts";

/**
 * Pending-send-proof backup + recovery for the NIP-60 "Send > eCash token" flow.
 *
 * Background / why this module exists
 * -----------------------------------
 * When a user generates an eCash token, `sendToken()` swaps the proofs OUT of the
 * NIP-60 wallet and encodes them into a token string. For a *user* send (as
 * opposed to a paid API call) the token string is NOT persisted anywhere — the
 * only surviving copy of the sats is the React `generatedToken` state. If the
 * wallet modal is closed before the user copies the token, that state is wiped
 * and the funds become irrecoverable.
 *
 * To make this safe we write a localStorage backup of the swapped proofs and keep
 * it alive until the user *explicitly* confirms the send (copies / shares the
 * token) or discards it. On the next app load, `recoverPendingSendProofs()`
 * re-credits any abandoned send back into the wallet.
 *
 * Two historical bugs this module fixes:
 *   1. The backup was deleted immediately after encoding the token, BEFORE it
 *      reached the UI, so an accidental modal-close lost the funds.
 *   2. The backup stored the mint URL under `normalizedMintUrl` but recovery read
 *      `mintUrl`, so even a surviving backup was never re-credited (it was just
 *      discarded). Here the persisted shape always uses `mintUrl`.
 */

export const PENDING_SEND_PROOFS_PREFIX = "pending_send_proofs_";

/** Default recovery window: only auto-recover sends abandoned within the last hour. */
export const DEFAULT_RECOVERY_WINDOW_MS = 60 * 60 * 1000;

/** Minimal proof shape we persist (avoids storing extra fields). */
export interface SerializedProof {
  id: string;
  amount: number;
  secret: string;
  C: string;
}

export interface PendingSendProofsRecord {
  /** Mint URL the proofs belong to. Always stored under `mintUrl`. */
  mintUrl: string;
  proofsToSend: SerializedProof[];
  /** When the backup was created (ms epoch). */
  timestamp: number;
  /** Amount encoded into the token (in the mint's unit). */
  tokenAmount: number;
  /**
   * True once the user has explicitly copied/sent the token. A confirmed send is
   * NOT re-credited on the next load (the user already holds the token); the
   * backup is simply cleaned up.
   */
  sent: boolean;
}

function serializeProofs(proofs: Proof[]): SerializedProof[] {
  return proofs.map((p) => ({
    id: p.id || "",
    amount: p.amount,
    secret: p.secret || "",
    C: p.C || "",
  }));
}

/**
 * Persist a backup of the proofs that were just swapped out for a send token.
 * Returns the storage key, which the caller keeps so it can later mark the send
 * as confirmed (copied/sent) or discard it.
 */
export function savePendingSendProofs(
  storage: Storage,
  params: {
    mintUrl: string;
    proofsToSend: Proof[];
    tokenAmount: number;
    now?: number;
  }
): string {
  const now = params.now ?? Date.now();
  const key = `${PENDING_SEND_PROOFS_PREFIX}${now}`;
  const record: PendingSendProofsRecord = {
    mintUrl: params.mintUrl,
    proofsToSend: serializeProofs(params.proofsToSend),
    timestamp: now,
    tokenAmount: params.tokenAmount,
    sent: false,
  };
  storage.setItem(key, JSON.stringify(record));
  return key;
}

/**
 * Mark a pending send as explicitly confirmed (the user copied/shared the token).
 * The backup is removed so recovery will not re-credit (and thus invalidate) the
 * token the user now holds.
 */
export function markPendingSendProofsSent(storage: Storage, key: string): void {
  // We simply drop the backup: once the user holds the token, re-crediting the
  // wallet would double-spend the proofs the recipient is about to redeem.
  storage.removeItem(key);
}

/**
 * Discard a pending send without re-crediting (e.g. the user tapped "Discard").
 */
export function clearPendingSendProofs(storage: Storage, key: string): void {
  storage.removeItem(key);
}

function listPendingKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(PENDING_SEND_PROOFS_PREFIX)) keys.push(k);
  }
  return keys;
}

/**
 * Recover any abandoned sends. For each non-confirmed backup that is still within
 * the recovery window, the proofs are re-credited to the wallet via `restore`.
 * All processed backups (recovered, stale, confirmed, or corrupt) are then removed.
 *
 * `sessionStorage` is used to de-dupe recovery within a single browser session so
 * a backup is not re-credited twice if recovery runs from multiple mount points.
 */
export async function recoverPendingSendProofs(
  storage: Storage,
  session: Pick<Storage, "getItem" | "setItem">,
  options: {
    restore: (args: {
      mintUrl: string;
      proofsToAdd: SerializedProof[];
    }) => Promise<void> | void;
    now?: number;
    maxAgeMs?: number;
  }
): Promise<void> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_RECOVERY_WINDOW_MS;

  for (const key of listPendingKeys(storage)) {
    try {
      const recoveryKey = `recovery_processed_${key}`;
      if (session.getItem(recoveryKey)) {
        continue;
      }

      const raw = storage.getItem(key);
      if (!raw) continue;
      const record = JSON.parse(raw) as Partial<PendingSendProofsRecord>;
      const { mintUrl, proofsToSend, timestamp, sent } = record;

      const fresh = typeof timestamp === "number" && now - timestamp < maxAgeMs;

      if (
        !sent &&
        fresh &&
        mintUrl &&
        proofsToSend &&
        proofsToSend.length > 0
      ) {
        // Mark as being processed BEFORE restoring so a concurrent mount does
        // not re-credit the same proofs.
        session.setItem(recoveryKey, "true");
        await options.restore({ mintUrl, proofsToAdd: proofsToSend });
      }

      // Clean up the backup regardless of whether it was recovered, stale, or
      // already confirmed.
      storage.removeItem(key);
    } catch {
      // Corrupt entry — remove it so it does not block future recoveries.
      storage.removeItem(key);
    }
  }
}
