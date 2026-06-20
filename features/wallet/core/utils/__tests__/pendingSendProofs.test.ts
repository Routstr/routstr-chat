import { describe, it, expect, beforeEach } from "vitest";
import type { Proof } from "@cashu/cashu-ts";
import {
  PENDING_SEND_PROOFS_PREFIX,
  savePendingSendProofs,
  markPendingSendProofsSent,
  clearPendingSendProofs,
  recoverPendingSendProofs,
} from "../pendingSendProofs";

/**
 * In-memory localStorage / sessionStorage shim that satisfies the subset of the
 * Web Storage API used by the pending-send-proof recovery logic.
 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  } as unknown as Storage;
}

const MINT = "https://mint.example.com";

function proof(amount: number, secret: string): Proof {
  return {
    id: "009a1f293253e41e",
    amount,
    secret,
    C: `C_${secret}`,
  } as Proof;
}

describe("pendingSendProofs (NIP-60 send recovery)", () => {
  let local: Storage;
  let session: Storage;

  beforeEach(() => {
    local = createMemoryStorage();
    session = createMemoryStorage();
  });

  it("persists the backup under a recoverable key/shape", () => {
    const proofsToSend = [proof(8, "a"), proof(2, "b")];
    const key = savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend,
      tokenAmount: 10,
      now: 1_000,
    });

    expect(key.startsWith(PENDING_SEND_PROOFS_PREFIX)).toBe(true);

    const raw = local.getItem(key);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // The mint URL MUST be stored under `mintUrl` so recoverPendingSendProofs
    // (which reads `mintUrl`) can re-credit the wallet. The original bug stored
    // it under `normalizedMintUrl`, which made recovery silently no-op.
    expect(parsed.mintUrl).toBe(MINT);
    expect(parsed.proofsToSend).toHaveLength(2);
  });

  it("REGRESSION: an abandoned send (modal closed before copy) is re-credited", async () => {
    const proofsToSend = [proof(8, "a"), proof(2, "b")];

    // 1. sendToken() generates the token and persists the backup.
    savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend,
      tokenAmount: 10,
      now: Date.now(),
    });

    // 2. The user closes the wallet modal WITHOUT copying the token. The only
    //    in-memory copy (React `generatedToken`) is dropped. The backup must
    //    survive so the funds are not lost.
    expect(
      Object.keys(localDump(local)).filter((k) =>
        k.startsWith(PENDING_SEND_PROOFS_PREFIX)
      )
    ).toHaveLength(1);

    // 3. On the next app load, recovery runs.
    const restored: Array<{ mintUrl: string; proofs: Proof[] }> = [];
    await recoverPendingSendProofs(local, session, {
      now: Date.now(),
      restore: async ({ mintUrl, proofsToAdd }) => {
        restored.push({ mintUrl, proofs: proofsToAdd });
      },
    });

    // The abandoned proofs must be re-credited to the wallet.
    expect(restored).toHaveLength(1);
    expect(restored[0].mintUrl).toBe(MINT);
    expect(restored[0].proofs.map((p) => p.secret).sort()).toEqual(["a", "b"]);

    // And the backup is cleaned up afterwards.
    const remaining = Object.keys({ ...localDump(local) }).filter((k) =>
      k.startsWith(PENDING_SEND_PROOFS_PREFIX)
    );
    expect(remaining).toHaveLength(0);
  });

  it("does NOT re-credit a send that was explicitly confirmed (copied/sent)", async () => {
    const proofsToSend = [proof(10, "a")];
    const key = savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend,
      tokenAmount: 10,
      now: Date.now(),
    });

    // User copies the token -> we mark the send as confirmed and drop the backup.
    markPendingSendProofsSent(local, key);

    const restored: Proof[] = [];
    await recoverPendingSendProofs(local, session, {
      now: Date.now(),
      restore: async ({ proofsToAdd }) => {
        restored.push(...proofsToAdd);
      },
    });

    // Nothing to recover: the user already has the token.
    expect(restored).toHaveLength(0);
  });

  it("ignores stale backups older than the recovery window", async () => {
    const now = 10_000_000;
    savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend: [proof(10, "a")],
      tokenAmount: 10,
      now: now - 2 * 60 * 60 * 1000, // 2h old
    });

    const restored: Proof[] = [];
    await recoverPendingSendProofs(local, session, {
      now,
      maxAgeMs: 60 * 60 * 1000,
      restore: async ({ proofsToAdd }) => {
        restored.push(...proofsToAdd);
      },
    });

    expect(restored).toHaveLength(0);
    // Stale entry is cleaned up.
    expect(
      Object.keys(localDump(local)).filter((k) =>
        k.startsWith(PENDING_SEND_PROOFS_PREFIX)
      )
    ).toHaveLength(0);
  });

  it("HARDENING: a restore() failure does NOT delete the backup (funds stay recoverable)", async () => {
    const key = savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend: [proof(8, "a"), proof(2, "b")],
      tokenAmount: 10,
      now: Date.now(),
    });

    // First recovery attempt: restore throws (e.g. wallet failed to persist).
    await expect(
      recoverPendingSendProofs(local, session, {
        now: Date.now(),
        restore: async () => {
          throw new Error("wallet update failed");
        },
      })
    ).rejects.toThrow("wallet update failed");

    // The backup MUST still exist — deleting it would lose the only copy of the funds.
    expect(local.getItem(key)).not.toBeNull();

    // The session de-dupe marker must be rolled back so a retry is allowed.
    expect(session.getItem(`recovery_processed_${key}`)).toBeFalsy();

    // Second attempt succeeds and now the backup is cleaned up.
    const restored: Proof[] = [];
    await recoverPendingSendProofs(local, session, {
      now: Date.now(),
      restore: async ({ proofsToAdd }) => {
        restored.push(...(proofsToAdd as unknown as Proof[]));
      },
    });
    expect(restored.map((p) => p.secret).sort()).toEqual(["a", "b"]);
    expect(local.getItem(key)).toBeNull();
  });

  it("HARDENING: a corrupt/unparseable entry IS removed (it can never be recovered)", async () => {
    const key = `${PENDING_SEND_PROOFS_PREFIX}corrupt`;
    local.setItem(key, "{ not valid json");

    let restoreCalled = false;
    await recoverPendingSendProofs(local, session, {
      now: Date.now(),
      restore: async () => {
        restoreCalled = true;
      },
    });

    expect(restoreCalled).toBe(false);
    // Corrupt entries are pruned so they don't block future recoveries.
    expect(local.getItem(key)).toBeNull();
  });

  it("clearPendingSendProofs (discard) removes the backup without recovery", async () => {
    const key = savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend: [proof(10, "a")],
      tokenAmount: 10,
      now: Date.now(),
    });

    clearPendingSendProofs(local, key);
    expect(local.getItem(key)).toBeNull();
  });
});

// Helper to enumerate keys from our memory storage shim for assertions.
function localDump(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) out[k] = storage.getItem(k) ?? "";
  }
  return out;
}
