// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { PENDING_SEND_PROOFS_PREFIX } from "../../core/utils/pendingSendProofs";

// jsdom does not implement the Web Storage API, so install a minimal in-memory
// localStorage/sessionStorage shim. The hook reads/writes the recoverable backup
// through these globals; this lets us assert exactly what it persists.
function installMemoryStorage(name: "localStorage" | "sessionStorage") {
  const map = new Map<string, string>();
  const storage = {
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
  } as Storage;
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
  // Object.keys(localStorage) is used by the production code under test; expose
  // the entries enumerably so it works.
  return storage;
}
installMemoryStorage("localStorage");
installMemoryStorage("sessionStorage");

/**
 * Hook-level test for useCashuToken.sendToken that exercises the REAL scoping
 * logic added for chat#210-v2: the recoverable pending_send_proofs_* backup must
 * be left behind ONLY for interactive USER sends. The paid-API spend path
 * (spendCashu, baseUrl != '') calls sendToken with { isUserSend: false } and must
 * NOT leave any recoverable backup — otherwise recoverPendingProofs() re-credits
 * it on the next load (double-credit / "proofs already spent").
 *
 * All wallet/mint/store/nostr dependencies are mocked; no network, no real Cashu
 * spends. wallet.send() returns deterministic keep/send proof sets so we can
 * inspect exactly what sendToken persists to localStorage.
 */

// --- Mock proofs returned by the mocked wallet.send() ---------------------------
const KEEP_PROOFS = [{ id: "ks1", amount: 5, secret: "keep1", C: "Ckeep1" }];
const SEND_PROOFS = [
  { id: "ks1", amount: 8, secret: "send1", C: "Csend1" },
  { id: "ks1", amount: 2, secret: "send2", C: "Csend2" },
];
const STORE_PROOFS = [
  { id: "ks1", amount: 7, secret: "p1", C: "Cp1" },
  { id: "ks1", amount: 8, secret: "p2", C: "Cp2" },
];

const MINT_URL = "https://mint.example.com";

// --- @cashu/cashu-ts: stub Mint/Wallet so loadMint()/send() never hit network --
vi.mock("@cashu/cashu-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cashu/cashu-ts")>();
  class Mint {
    constructor(public url: string) {}
    mints = [MINT_URL];
  }
  class Wallet {
    mints = [MINT_URL];
    constructor(
      public mint: unknown,
      public opts?: unknown
    ) {}
    async loadMint() {}
    async send() {
      return { keep: KEEP_PROOFS, send: SEND_PROOFS };
    }
    async checkProofsStates() {
      return [];
    }
    async receive() {
      return [];
    }
  }
  return {
    ...actual,
    Mint,
    Wallet,
    // getEncodedTokenV4 must produce a stable, decodable-enough string for the map.
    getEncodedTokenV4: (t: { proofs: { secret: string }[] }) =>
      `cashuTEST_${t.proofs.map((p) => p.secret).join("-")}`,
  };
});

// --- Store mock -----------------------------------------------------------------
const storeState = {
  mints: [
    { url: MINT_URL, keysets: [{ id: "ks1", active: true, unit: "sat" }] },
  ],
  getMint: (_url: string) => ({
    keysets: [{ id: "ks1", active: true, unit: "sat" }],
  }),
  getMintProofs: async (_url: string) => STORE_PROOFS,
  addMint: vi.fn(),
  setMintInfo: vi.fn(),
  setKeysets: vi.fn(),
  setKeys: vi.fn(),
};
vi.mock("../../state/cashuStore", () => ({
  useCashuStore: () => storeState,
}));

// --- Wallet hook mock -----------------------------------------------------------
type UpdateProofsArg = {
  mintUrl: string;
  proofsToAdd: { secret: string }[];
  proofsToRemove: { secret: string }[];
};
const updateProofs = vi.fn(async (_arg: UpdateProofsArg) => {});
vi.mock("../useCashuWallet", () => ({
  useCashuWallet: () => ({
    wallet: { mints: [MINT_URL] },
    createWallet: vi.fn(async () => {}),
    updateProofs,
    tokens: [],
  }),
}));

// --- History hook mock ----------------------------------------------------------
vi.mock("../useCashuHistory", () => ({
  useCashuHistory: () => ({ createHistory: vi.fn(async () => {}) }),
}));

// --- MintService mock (activateMint must not hit the network) -------------------
vi.mock("../../core/services/MintService", () => ({
  MintService: class {
    async activateMint() {
      return { mintInfo: {}, keysets: [], keys: [] };
    }
  },
}));

import { useCashuToken } from "../useCashuToken";

function pendingBackupKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PENDING_SEND_PROOFS_PREFIX)) keys.push(k);
  }
  return keys;
}

describe("useCashuToken.sendToken — recoverable-backup scoping (chat#210-v2)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    updateProofs.mockClear();
    // Suppress the recovery useEffect noise / console logs.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("API-spend path (isUserSend:false) leaves NO recoverable pending_send_proofs_* backup", async () => {
    const { result } = renderHook(() => useCashuToken());

    let token = "";
    await act(async () => {
      token = await result.current.sendToken(
        MINT_URL,
        10,
        undefined,
        undefined,
        { isUserSend: false }
      );
    });

    expect(token).toContain("cashuTEST_");
    // THE ASSERTION: the paid-API path must not leave a recoverable backup.
    // On the un-scoped base branch (sendToken always defers cleanup), this is
    // length 1 and the test FAILS — proving the regression is fixed here.
    expect(pendingBackupKeys()).toHaveLength(0);
  });

  it("USER-send path (default isUserSend) DEFERS cleanup: backup survives until confirm", async () => {
    const { result } = renderHook(() => useCashuToken());

    let token = "";
    await act(async () => {
      // No options => isUserSend defaults to true (interactive send).
      token = await result.current.sendToken(MINT_URL, 10);
    });

    // The recoverable backup MUST still be present (modal could be closed before copy).
    const keys = pendingBackupKeys();
    expect(keys).toHaveLength(1);

    // Confirming the send (user copied the token) clears the backup.
    act(() => {
      result.current.confirmTokenSent(token);
    });
    expect(pendingBackupKeys()).toHaveLength(0);
  });

  it("USER-send path: discardToken re-credits the swapped-out proofs and clears the backup", async () => {
    const { result } = renderHook(() => useCashuToken());

    let token = "";
    await act(async () => {
      token = await result.current.sendToken(MINT_URL, 10);
    });
    expect(pendingBackupKeys()).toHaveLength(1);
    updateProofs.mockClear();

    await act(async () => {
      await result.current.discardToken(token);
    });

    // The send proofs are re-credited back to the wallet on discard.
    expect(updateProofs).toHaveBeenCalledTimes(1);
    const arg = updateProofs.mock.calls[0][0];
    expect(arg.mintUrl).toBe(MINT_URL);
    expect(arg.proofsToAdd.map((p) => p.secret).sort()).toEqual([
      "send1",
      "send2",
    ]);
    expect(pendingBackupKeys()).toHaveLength(0);
  });
});
