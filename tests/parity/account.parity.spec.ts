// Parity, accounts and sync.
import { expect, newKey, readyToChat, test } from "./fixtures";
import { seedAccounts } from "../app/seed";
import { seal } from "../kit/net";

test("A4 two keys on one device keep their money apart", async ({
  page,
  context,
  driver,
  kit,
  appUrl,
}) => {
  // an intended difference: main keeps one wallet for every key on a device (its "cashu"
  // store), v2 gives each account its own
  test.fail(driver.name === "main", "main shares one wallet between keys");
  await seedAccounts(context, [newKey(), newKey()]);
  await driver.open(page, appUrl);
  await driver.receive(page, await kit.mintToken(40));
  // the other key holds nothing; back on this key, its 40 again, also after a reload
  const shows = (sats: number) =>
    expect
      .poll(() => driver.balance(page).catch(() => -1), { timeout: 30_000 })
      .toBe(sats);
  await driver.switchAccount(page);
  await shows(0);
  await driver.switchAccount(page);
  await shows(40);
  await page.reload();
  await driver.ready(page);
  await shows(40);
});

test("H2 chats follow the key to a second device", async ({
  page,
  browser,
  driver,
  kit,
  appUrl,
}) => {
  const nsec = newKey();
  await readyToChat(
    page,
    driver,
    appUrl,
    kit.coreUrl,
    await kit.mintToken(300),
    nsec
  );
  await driver.send(page, "remember this chat");
  await driver.waitReplyText(page, "Echo: remember this chat");
  await driver.waitIdle(page);

  const other = await browser.newContext({ serviceWorkers: "block" });
  await seal(other, kit.env, appUrl);
  const second = await other.newPage();
  await driver.open(second, appUrl);
  await driver.signIn(second, nsec);
  await driver.waitChats(second, 1);
  await other.close();
});
