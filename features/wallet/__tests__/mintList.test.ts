import { expect, it, vi } from "vitest";
import { listMint } from "../hooks/purseBridge";
import { listedMints, takeOffMint } from "../mintList";
import { useWalletStore } from "../state/walletStore";

const activateMint = vi.hoisted(() => vi.fn());
vi.mock("../core/services/MintService", () => ({
  MintService: class {
    activateMint = activateMint;
  },
}));

const A = "https://a.test";
const B = "https://b.test";

function wallet(owner: string) {
  const store = useWalletStore.of(owner);
  store.getState().addMint(A);
  store.getState().addMint(B);
  const published: string[][] = [];
  const publish = async ({ mints }: { mints: string[] }) =>
    void published.push(mints);
  return { store, published, publish };
}

const urls = (owner: string) =>
  useWalletStore
    .of(owner)
    .getState()
    .mints.map((m) => m.url);

it("takes an empty mint off the event and the list, and the wallet never lists it again by itself", async () => {
  const { store, published, publish } = wallet("empty");
  await takeOffMint(A, {
    event: { privkey: "k", mints: [A, B] },
    publish,
    store: store.getState(),
  });
  expect(published).toEqual([[B]]);
  expect(urls("empty")).toEqual([B]);
  expect(listedMints(urls("empty"), {})).toEqual([B]);

  // the wallet event read again, a coin landing there: still off
  store.getState().addMint(A);
  await listMint(store.getState(), A);
  expect(activateMint).not.toHaveBeenCalled();
  expect(urls("empty")).toEqual([B]);
  // until the person adds it
  store.getState().addMint(A, true);
  expect(urls("empty")).toEqual([B, A]);
});

it("keeps a mint that still holds sats listed, though it is off the wallet's own list", async () => {
  const { store, publish } = wallet("holding");
  await takeOffMint(A, {
    event: { privkey: "k", mints: [A, B] },
    publish,
    store: store.getState(),
  });
  expect(urls("holding")).toEqual([B]);
  expect(listedMints(urls("holding"), { [A]: 21, [B]: 0 })).toEqual([B, A]);
  // once its sats are gone, so is its row
  expect(listedMints(urls("holding"), { [A]: 0 })).toEqual([B]);
});

it("does nothing more on a second press, and does not throw", async () => {
  const { store, published, publish } = wallet("twice");
  const event = { privkey: "k", mints: [A, B] };
  await takeOffMint(A, { event, publish, store: store.getState() });
  await takeOffMint(A, {
    event: { privkey: "k", mints: [B] },
    publish,
    store: store.getState(),
  });
  expect(published).toEqual([[B]]);
  expect(urls("twice")).toEqual([B]);
  expect(store.getState().removed).toEqual([A]);
});
