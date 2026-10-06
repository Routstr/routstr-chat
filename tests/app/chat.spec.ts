import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedKitProvider } from "./seed";

test("pays for a reply through routstr-core and keeps the change", async ({
  page,
  kit,
  appUrl,
}) => {
  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(300));
  expect(await v2.balance(page)).toBe(300);

  // a fixed, tiny usage: well under one sat, so core charges exactly one whole sat
  await v2.send(page, "[kit:usage=10,10] hello kit");
  await v2.waitReplyText(page, "Echo: hello kit");
  expect((await kit.upstream.requests()).map((r) => r.outcome)).toEqual(["ok"]);

  // the change is kept: 299, not 300 minus the whole token the reply carried
  // (with an API key, the default, it waits on the key until it is returned)
  await v2.returnCredit(page);
  await expect.poll(() => v2.balance(page), { timeout: 20_000 }).toBe(299);
  // and it is spendable money, not a number: all of it redeems at the mint
  await v2.useMint(page, kit.env.mintUrl);
  expect(await kit.redeem(await v2.makeToken(page, 299))).toBe(299);
});
