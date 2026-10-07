// The account's NIP-60 wallet event on the kit relay: what is published is read back, the
// latest one wins, and the default mints are always in its list.
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
} from "nostr-tools";
import { expect, it } from "vitest";
import { getKit } from "@/tests/kit";
import { memoryStorage as relayStorage } from "@/features/relays/__tests__/fakes";
import { Relays } from "@/features/relays/service";
import { defaultMints } from "@/features/wallet/core/services/MintService";
import { publishWallet, readWallet } from "@/features/wallet/walletEvent";
import { newRelayPool, poolPort } from "@/platform/nostr/pool";

const kit = getKit();
const relays = new Relays(
  poolPort(newRelayPool()),
  relayStorage(),
  `?relays=${kit.env.relayUrl}`
);

it("reads back the latest wallet event it published, with the default mints", async () => {
  const secret = generateSecretKey();
  const owner = getPublicKey(secret);
  const key = nip44.getConversationKey(secret, owner);
  const deps = {
    signer: {
      encrypt: async (text: string) => nip44.encrypt(text, key),
      decrypt: async (text: string) => nip44.decrypt(text, key),
      sign: async (template: Parameters<typeof finalizeEvent>[0]) =>
        finalizeEvent(template, secret),
    },
    relays: relays.of(owner),
  };
  expect(await readWallet(owner, deps)).toBeNull();

  await publishWallet(deps, { privkey: "aa", mints: ["https://one.test/"] });
  // a second later, so it is the newer one
  await new Promise((r) => setTimeout(r, 1100));
  const event = await publishWallet(deps, {
    privkey: "bb",
    mints: ["https://two.test/", "https://two.test"],
  });

  const wallet = await readWallet(owner, deps);
  expect(wallet).toMatchObject({ id: event.id, privkey: "bb" });
  expect(wallet!.mints.sort()).toEqual(
    [
      ...new Set([
        "https://two.test",
        ...defaultMints.map((m) => m.replace(/\/$/, "")),
      ]),
    ].sort()
  );
}, 30_000);
