// A mint's keysets are saved as cashu-ts objects and come back from storage as _id/_unit.
import { expect, it, vi } from "vitest";
import { memoryStorage } from "@/features/book/journal";

it("finds a mint's coins after a reload brought its keysets back as _id", async () => {
  const storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: vi.fn() });
  const coin = (secret: string) => ({
    id: "00ad268c4d1f5826",
    amount: 8,
    secret,
    C: "02",
  });
  storage.setItem(
    "cashu:alice",
    JSON.stringify({
      state: {
        proofs: [coin("a"), coin("b")],
        mints: [
          { url: "m", keysets: [{ _id: "00ad268c4d1f5826", _unit: "sat" }] },
        ],
      },
      version: 0,
    })
  );
  vi.resetModules();
  const { useCashuStore } = await import("../cashuStore");
  const proofs = await useCashuStore.of("alice").getState().getMintProofs("m");
  expect(proofs.map((p) => p.secret)).toEqual(["a", "b"]);
});
