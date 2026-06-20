import { describe, it, expect, beforeEach } from "vitest";
import type { Proof } from "@cashu/cashu-ts";
import {
  PENDING_SEND_PROOFS_PREFIX,
  savePendingSendProofs,
  recoverPendingSendProofs,
} from "../pendingSendProofs";

/**
 * Adversarial / red-team tests for recoverPendingSendProofs.
 *
 * These reproduce two PROVEN fund-loss holes:
 *
 *   HOLE-1 cross-tab double-credit: the original de-dupe guard lived in
 *     sessionStorage (tab-private), so two browser tabs each running recovery
 *     would BOTH restore() the same backup -> the wallet is credited twice for a
 *     single abandoned send (a double-credit / mint over-spend on redeem).
 *
 *   HOLE-2 early loop abort: a `throw err` inside the recovery for-loop aborted
 *     the whole pass on the first restore() failure, so every later backup was
 *     skipped. Skipped backups then go stale (past the recovery window) on the
 *     next load and are dropped -> funds lost.
 */

/** In-memory Web Storage shim shared by all tabs in a test (i.e. localStorage). */
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

function pendingKeys(storage: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(PENDING_SEND_PROOFS_PREFIX)) out.push(k);
  }
  return out;
}

describe("pendingSendProofs (adversarial / fund-loss holes)", () => {
  let local: Storage;
  // Each "tab" gets its OWN sessionStorage (tab-private) but SHARES localStorage.
  let sessionTabA: Storage;
  let sessionTabB: Storage;

  beforeEach(() => {
    local = createMemoryStorage();
    sessionTabA = createMemoryStorage();
    sessionTabB = createMemoryStorage();
  });

  it("HOLE-1: two concurrent tabs restore an abandoned backup EXACTLY once (no cross-tab double-credit)", async () => {
    // One abandoned send sitting in shared localStorage.
    savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend: [proof(8, "a"), proof(2, "b")],
      tokenAmount: 10,
      now: Date.now(),
    });

    const restores: Array<{ tab: string; secrets: string[] }> = [];

    // restore() is async with a real yield, modelling the network/wallet write.
    // Both tabs read the (shared) backup before either finishes, exactly the
    // race that produced the cross-tab double-credit.
    const makeRestore = (tab: string) => async ({
      proofsToAdd,
    }: {
      mintUrl: string;
      proofsToAdd: { secret: string }[];
    }) => {
      await new Promise((r) => setTimeout(r, 5));
      restores.push({ tab, secrets: proofsToAdd.map((p) => p.secret).sort() });
    };

    // Tab A and Tab B run recovery concurrently. They share `local` but have
    // distinct sessionStorage — so a sessionStorage de-dupe (the original bug)
    // would NOT protect against this and both tabs would restore.
    await Promise.all([
      recoverPendingSendProofs(local, sessionTabA, {
        now: Date.now(),
        restore: makeRestore("A"),
      }),
      recoverPendingSendProofs(local, sessionTabB, {
        now: Date.now(),
        restore: makeRestore("B"),
      }),
    ]);

    // The backup must be re-credited EXACTLY ONCE across both tabs.
    expect(restores).toHaveLength(1);
    expect(restores[0].secrets).toEqual(["a", "b"]);

    // And the backup is cleaned up.
    expect(pendingKeys(local)).toHaveLength(0);
  });

  it("HOLE-2: a restore() failure on one backup does NOT skip later recoverable backups", async () => {
    const now = Date.now();

    // Three abandoned sends. The first one's restore() will fail; the later two
    // must STILL be recovered (the original `throw err` aborted the loop and
    // skipped them, after which they would go stale and be dropped).
    const keyFail = savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend: [proof(1, "fail")],
      tokenAmount: 1,
      now: now - 3, // earliest key -> processed first (keys sort by timestamp)
    });
    savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend: [proof(5, "later1")],
      tokenAmount: 5,
      now: now - 2,
    });
    savePendingSendProofs(local, {
      mintUrl: MINT,
      proofsToSend: [proof(7, "later2")],
      tokenAmount: 7,
      now: now - 1,
    });

    const restored: string[] = [];

    await expect(
      recoverPendingSendProofs(local, sessionTabA, {
        now,
        restore: async ({ proofsToAdd }) => {
          const secret = proofsToAdd[0].secret;
          if (secret === "fail") throw new Error("wallet update failed");
          restored.push(secret);
        },
      })
      // The failure is still surfaced to the caller AFTER the full pass...
    ).rejects.toThrow("wallet update failed");

    // ...but the later, recoverable backups were NOT skipped.
    expect(restored.sort()).toEqual(["later1", "later2"]);

    // The failing backup is PRESERVED for a future retry (never removeItem'd on
    // restore failure) so its funds remain recoverable.
    expect(local.getItem(keyFail)).not.toBeNull();

    // The two recovered backups were cleaned up.
    expect(pendingKeys(local).sort()).toEqual([keyFail]);
  });
});
