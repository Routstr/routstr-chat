/**
 * A provider that fails a reply for a model is left out for that model for a
 * while, and the picker shows it: a request on the warm model list records its
 * failures in the provider manager the picker reads (catalog.warm). The SDK
 * cools the model down there for 10 s, longer each failure in a row. Two
 * providers here are one routstr-core under two addresses.
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
const MODEL = "kit-cheap";

it("leaves out a provider that failed a reply for a model, in the picker too", async () => {
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
  const ranked = () => routing.catalog.routes(MODEL).map((r) => r.baseUrl);
  // the first provider fails the reply, the other answers it
  const reply = async (id: string) => {
    await kit.upstream.queue({ fail: 500 });
    const turn = await chat.chat.send(id, "hi", { id: MODEL });
    await turn.settled;
    await turn.reply;
    expect(turn.run.getSnapshot().phase).toBe("done");
  };

  const first = ranked()[0];
  expect(ranked()).toHaveLength(2);
  await reply("c1");

  expect(ranked()).not.toContain(first);
  expect(ranked()).toHaveLength(1);
  await chat.refund();
  chat.dispose();
});
