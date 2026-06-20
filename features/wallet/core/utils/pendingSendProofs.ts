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
  /**
   * Cross-tab recovery claim. Set on the SHARED (localStorage) record — not on
   * tab-private sessionStorage — immediately before `restore()` runs. A second
   * tab that reads back a record already claimed within `CLAIM_TTL_MS` skips it,
   * so a single backup is restored exactly once even with concurrent tabs.
   */
  processing?: boolean;
  /** Epoch ms when `processing` was set. Used to expire stale/abandoned claims. */
  claimedAt?: number;
}

/**
 * How long a `{ processing: true }` claim is honoured before a later recovery
 * pass is allowed to reclaim the record. This bounds the damage if a tab sets
 * the claim and then dies mid-restore (e.g. crash/refresh) without rolling back:
 * the funds become recoverable again after the TTL rather than being stranded.
 */
export const CLAIM_TTL_MS = 30 * 1000;

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
 * Atomically claim a backup record for recovery in SHARED storage (localStorage).
 *
 * This is the cross-tab de-dupe guard. We read the current record, and if it is
 * already claimed (`processing: true`) within `CLAIM_TTL_MS`, we return `null`
 * so the caller skips it — another tab/pass owns it. Otherwise we write back the
 * record with `{ processing: true, claimedAt: now }` and return the parsed
 * record so the caller can restore it.
 *
 * Web Storage is synchronous and single-threaded per tab, so this read-modify-
 * write is atomic *within* a tab. Across tabs there is no true CAS, but because
 * each tab re-reads and re-writes the same shared key, the window in which two
 * tabs both observe an unclaimed record and proceed is the few microseconds
 * between this function's getItem and setItem — and the `claimedAt` TTL plus the
 * post-restore `removeItem` make a double-credit vanishingly unlikely in
 * practice. (`navigator.locks` would close that window entirely; it is used as
 * an outer guard by the caller when available — see recoverPendingProofs.)
 *
 * Returns the parsed record on a successful claim, or `null` to skip.
 */
function claimRecordForRecovery(
  storage: Storage,
  key: string,
  now: number
): Partial<PendingSendProofsRecord> | null {
  const raw = storage.getItem(key);
  if (!raw) return null;

  let record: Partial<PendingSendProofsRecord>;
  try {
    record = JSON.parse(raw) as Partial<PendingSendProofsRecord>;
  } catch {
    // Corrupt/unparseable entry: can never be recovered. Prune and skip.
    storage.removeItem(key);
    return null;
  }

  // Already claimed by another tab/pass and still within the TTL -> skip.
  if (
    record.processing === true &&
    typeof record.claimedAt === "number" &&
    now - record.claimedAt < CLAIM_TTL_MS
  ) {
    return null;
  }

  // Take the claim by writing the marker back to the SHARED record. A second tab
  // that now reads this key will see `processing: true` and skip it.
  const claimed: Partial<PendingSendProofsRecord> = {
    ...record,
    processing: true,
    claimedAt: now,
  };
  storage.setItem(key, JSON.stringify(claimed));
  return record;
}

/**
 * Release a recovery claim previously taken by `claimRecordForRecovery`, so a
 * later recovery pass may retry the record. Used after a restore() failure: the
 * backup must stay recoverable, so we clear `processing` rather than delete it.
 */
function releaseRecordClaim(storage: Storage, key: string): void {
  const raw = storage.getItem(key);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as Partial<PendingSendProofsRecord>;
    delete record.processing;
    delete record.claimedAt;
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // If it became corrupt, leave it; the corrupt-prune path will handle it.
  }
}

/**
 * Recover any abandoned sends. For each non-confirmed backup that is still within
 * the recovery window, the proofs are re-credited to the wallet via `restore`.
 * All successfully processed backups (recovered, stale, confirmed, or corrupt)
 * are then removed. A backup whose restore() FAILS is preserved for a later retry.
 *
 * Cross-tab safety (HOLE-1): the recovery claim lives on the SHARED `storage`
 * (localStorage) record as `{ processing, claimedAt }`, NOT on tab-private
 * `sessionStorage`. Two tabs running recovery concurrently therefore see each
 * other's claim and a given backup is restored exactly once.
 *
 * Failure isolation (HOLE-2): each record is processed in its own try/catch and
 * a restore() failure NEVER aborts the loop — later backups are always processed
 * and never silently dropped. Failures are collected and re-thrown as an
 * aggregate AFTER the whole pass so the caller can still observe/log them.
 *
 * @param session Retained for backward-compatible signature; recovery no longer
 *   relies on sessionStorage for de-dupe (it was tab-private and double-credited
 *   across tabs). The shared-storage claim above supersedes it.
 */
export async function recoverPendingSendProofs(
  storage: Storage,
  _session: Pick<Storage, "getItem" | "setItem">,
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

  const failures: unknown[] = [];

  for (const key of listPendingKeys(storage)) {
    // Each iteration is fully isolated: a thrown error here is recorded and the
    // loop CONTINUES to the next key. We never re-throw mid-loop (HOLE-2).
    try {
      // Atomically claim the record in SHARED storage. Returns null when the
      // record is missing, corrupt (pruned), or already claimed by another tab.
      const record = claimRecordForRecovery(storage, key, now);
      if (!record) continue;

      const { mintUrl, proofsToSend, timestamp, sent } = record;
      const fresh = typeof timestamp === "number" && now - timestamp < maxAgeMs;
      const shouldRecover =
        !sent && fresh && !!mintUrl && !!proofsToSend && proofsToSend.length > 0;

      if (shouldRecover) {
        try {
          await options.restore({
            mintUrl: mintUrl!,
            proofsToAdd: proofsToSend!,
          });
        } catch (err) {
          // restore() failed (e.g. the wallet failed to persist the re-credit).
          // Do NOT delete the backup — it is the only surviving copy of the funds.
          // Release the claim so a later recovery attempt can retry, record the
          // failure, and CONTINUE to the next key (never abort the pass).
          releaseRecordClaim(storage, key);
          failures.push(err);
          continue;
        }
      }

      // Clean up the backup only on a successful outcome: recovered, stale, or
      // already confirmed. A restore failure `continue`s above and never reaches
      // here, so the backup is preserved for a future retry.
      storage.removeItem(key);
    } catch (err) {
      // Any unexpected error for this key (e.g. storage write failure) must not
      // strand the remaining backups. Record and move on.
      failures.push(err);
    }
  }

  // Surface failures AFTER the full pass so every backup was given a chance and
  // the caller can still log the error. The single-backup case (existing
  // hardening test) therefore still rejects, while multi-backup passes never
  // skip a later, recoverable backup because of an earlier failure (HOLE-2).
  if (failures.length > 0) {
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(
      failures,
      `recoverPendingSendProofs: ${failures.length} backups failed to restore`
    );
  }
}
