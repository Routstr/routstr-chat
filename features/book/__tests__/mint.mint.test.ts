// A mint's wallet is opened once and given again, and opened anew once the mint failed something
// (kit mint).
import { getEncodedTokenV4 } from "@cashu/cashu-ts";
import { expect, it, vi } from "vitest";
import { getKit } from "@/tests/kit";
import { WalletExecutor } from "../executor";
import { Journal, memoryStorage } from "../journal";
import { forgetWallets, openWallet } from "../mint";

const kit = getKit();
const MINT = kit.env.mintUrl;

it("opens a mint's wallet once, gives it again without asking the mint, and anew once forgotten", async () => {
  forgetWallets(MINT);
  const asks = vi.spyOn(globalThis, "fetch");
  try {
    const [a, b] = await Promise.all([openWallet(MINT), openWallet(MINT)]);
    expect(a).toBe(b);
    const asked = asks.mock.calls.length;
    expect(await openWallet(`${MINT}/`)).toBe(a);
    expect(asks.mock.calls.length).toBe(asked);

    forgetWallets(MINT);
    expect(await openWallet(MINT)).not.toBe(a);
  } finally {
    asks.mockRestore();
  }
});

it("opens the wallet anew after a payment the mint refused", async () => {
  const coins = await kit.mintProofs(8);
  // spent elsewhere first
  await kit.redeem(
    getEncodedTokenV4({ mint: MINT, unit: "sat", proofs: coins })
  );
  const before = await openWallet(MINT);
  const executor = new WalletExecutor({
    owner: "alice",
    journal: new Journal(memoryStorage()),
    locks: navigator.locks,
    commitFor: () => async () => undefined,
  });
  await expect(executor.send(MINT, 4, coins)).rejects.toThrow();
  expect(await openWallet(MINT)).not.toBe(before);
});
