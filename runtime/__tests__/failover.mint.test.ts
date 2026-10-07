/**
 * A reply that fails over: the first provider takes the new key's token and
 * then fails, the SDK makes a second key at another provider, and Return pays
 * out both. Two providers here are one routstr-core under two addresses: each
 * keeps its own key, as two nodes would.
 */
import { expect, it } from "vitest";
import {
  FakeHistory,
  memoryStorage,
  passThroughAttachments,
} from "@/features/chat/__tests__/fakes";
import { emptyDevice, fakeKeys } from "@/features/payments/__tests__/fakes";
import { getKit } from "@/tests/kit";
import { createAccountChat } from "../chat";
import { createRouting } from "../routing";
import { kitPurse } from "./kitPurse";

const kit = getKit();
const ONE = kit.coreUrl;
const TWO = ONE.replace("127.0.0.1", "localhost");

/** What core holds for a key, in msat. */
async function atCore(baseUrl: string, key: string): Promise<number> {
  const res = await fetch(`${baseUrl}v1/wallet/info`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return ((await res.json()) as { balance: number }).balance;
}

it("pays out both keys of a reply that failed over", async () => {
  const routing = createRouting({
    node: () => undefined,
    extraProviders: [ONE, TWO],
  });
  await routing.catalog.refresh();
  await kit.upstream.reset();
  const wallet = kitPurse(kit, "alice", kit.env.mintUrl);
  await wallet.fund(300);
  const credit = fakeKeys();
  await credit.keys.ready();
  const chat = createAccountChat({
    owner: "alice",
    storage: memoryStorage(),
    history: new FakeHistory(),
    attachments: passThroughAttachments(),
    keys: credit.keys,
    purse: wallet.purse,
    sdk: routing.payments,
    spending: () => ({ mode: "apikeys" }),
    ...emptyDevice(),
  });

  // the first provider to forward it fails once, after taking the token
  await kit.upstream.queue({ fail: 500 });
  const turn = await chat.chat.send("c", "hi", {
    id: "kit-cheap",
  });
  await turn.settled;
  await turn.reply;
  const keys = credit.keys.storage().getAllApiKeys();
  expect(turn.run.getSnapshot().phase).toBe("done");
  expect(keys.map((k) => k.baseUrl).sort()).toEqual([ONE, TWO].sort());
  for (const key of keys)
    expect(await atCore(key.baseUrl, key.key)).toBeGreaterThan(0);

  await chat.refund();

  expect(credit.keys.storage().getAllApiKeys()).toEqual([]);
  for (const key of keys) expect(await atCore(key.baseUrl, key.key)).toBe(0);
  expect(wallet.sats).toBeGreaterThanOrEqual(299);
  chat.dispose();
});
