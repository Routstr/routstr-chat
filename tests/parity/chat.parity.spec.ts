// Parity, chat: a paid reply, and a failed one that costs nothing, in both apps.
import { expect, newKey, readyToChat, test } from "./fixtures";

test("C1 a paid reply arrives and costs a few sats", async ({
  page,
  driver,
  kit,
  appUrl,
}) => {
  await readyToChat(
    page,
    driver,
    appUrl,
    kit.coreUrl,
    await kit.mintToken(300),
    newKey()
  );
  await kit.upstream.reset();
  await driver.send(page, "hello parity");
  await driver.waitReplyText(page, "Echo: hello parity");
  await driver.waitIdle(page);
  expect((await kit.upstream.requests()).map((r) => r.outcome)).toEqual(["ok"]);
  // what left the wallet is with core (charge + credit or held token), never more than a reply's max
  await expect
    .poll(() => driver.balance(page), { timeout: 30_000 })
    .toBeLessThan(300);
  const left = Math.floor(await driver.balance(page));
  expect(left).toBeGreaterThanOrEqual(300 - 15);
  // what is left is money, not a number: all of it redeems at the mint
  expect(await kit.redeem(await driver.makeToken(page, left))).toBe(left);
});

test("C6 a reply the provider fails shows an error and the sats come back", async ({
  page,
  driver,
  kit,
  appUrl,
}) => {
  await readyToChat(
    page,
    driver,
    appUrl,
    kit.coreUrl,
    await kit.mintToken(300),
    newKey()
  );
  await driver.send(page, "[kit:fail=500] this one fails");
  await driver.waitError(page);
  // nothing lost: whatever the app left at the provider (main keeps API-key credit) comes
  // back; asked again until it has, since the credit can show a moment after the error
  await expect
    .poll(
      async () => {
        await driver.returnCredit(page);
        return driver.balance(page);
      },
      { timeout: 60_000 }
    )
    .toBe(300);
  // back in the wallet, not just counted: all 300 leave as a token the mint honours
  expect(await kit.redeem(await driver.makeToken(page, 300))).toBe(300);
});

test("C2 Stop ends a reply while it streams", async ({
  page,
  driver,
  kit,
  appUrl,
}) => {
  await readyToChat(
    page,
    driver,
    appUrl,
    kit.coreUrl,
    await kit.mintToken(300),
    newKey()
  );
  const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
  await driver.send(page, `[kit:chunk=80] [kit:text=${words}] go`);
  await driver.waitReplyText(page, "w0"); // words are arriving (needs a streamed reply)
  await driver.stop(page);
  await driver.waitIdle(page);
  // the rest never comes: wait until the upstream has finished or been cut, then a moment
  // for anything still on its way. (Keeping the words that arrived is v2 only: main
  // replaces them with "Generation stopped.")
  await expect
    .poll(async () => (await kit.upstream.requests()).at(-1)?.outcome, {
      timeout: 30_000,
    })
    .toBeDefined();
  await page.waitForTimeout(1000);
  expect(await driver.replyText(page)).not.toContain("w59");
});

test("C3 asking again makes a second version of the reply", async ({
  page,
  driver,
  kit,
  appUrl,
}) => {
  await readyToChat(
    page,
    driver,
    appUrl,
    kit.coreUrl,
    await kit.mintToken(300),
    newKey()
  );
  await driver.send(page, "first take");
  await driver.waitReplyText(page, "Echo: first take");
  await driver.waitIdle(page);
  await driver.retryLast(page);
  await driver.waitIdle(page);
  await expect
    .poll(() => driver.lastVersion(page), { timeout: 60_000 })
    .toEqual({ at: 2, of: 2 });
});

test("C7 a reply's reasoning shows as thinking", async ({
  page,
  driver,
  kit,
  appUrl,
}) => {
  await readyToChat(
    page,
    driver,
    appUrl,
    kit.coreUrl,
    await kit.mintToken(300),
    newKey()
  );
  // slow chunks: main shows the reasoning only while the reply streams (the SDK keeps no
  // thinking on a text reply, so it is gone once the reply ends); v2 keeps it
  await driver.send(
    page,
    "[kit:think] [kit:chunk=300] [kit:text=one two three four five six seven eight] why"
  );
  await driver.waitThought(page);
  await driver.waitReplyText(page, "eight");
});
