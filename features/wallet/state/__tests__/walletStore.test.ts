import { expect, it } from "vitest";
import { memoryStorage } from "@/features/book/journal";
import { walletStorage } from "../walletStore";

const pk = "ab".repeat(32);
const old = {
  state: {
    proofs: [{ id: "k", amount: 8, secret: "s", C: "02" }],
    mints: [
      {
        url: "https://m1",
        keysets: [{ _id: "k", _unit: "sat" }],
        mintQuotes: {},
      },
    ],
    activeMintUrl: "https://m1",
    userSelectedMintUrl: "https://m1",
    privkey: "aa",
  },
  version: 0,
};

it("starts from main's old list once, and from then on keeps its own copy, never writing main's", () => {
  const storage = memoryStorage();
  storage.setItem(`cashu:${pk}`, JSON.stringify(old));
  const wallet = walletStorage(storage);

  const first = JSON.parse(wallet.getItem(`wallet-mints:${pk}`)!).state;
  expect(first).toEqual({
    mints: [{ url: "https://m1", keysets: [{ _id: "k", _unit: "sat" }] }],
    activeMintUrl: "https://m1",
    userSelectedMintUrl: "https://m1",
    privkey: "aa",
  });

  wallet.setItem(
    `wallet-mints:${pk}`,
    JSON.stringify({
      state: { mints: [], activeMintUrl: "https://m2" },
      version: 0,
    })
  );
  expect(
    JSON.parse(wallet.getItem(`wallet-mints:${pk}`)!).state.activeMintUrl
  ).toBe("https://m2");
  // main's blob is as it was
  expect(JSON.parse(storage.getItem(`cashu:${pk}`)!)).toEqual(old);
});

it("has nothing when neither copy exists", () => {
  expect(
    walletStorage(memoryStorage()).getItem(`wallet-mints:${pk}`)
  ).toBeNull();
});
