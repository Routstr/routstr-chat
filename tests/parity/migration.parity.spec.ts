// Parity, the data contract: someone who used main opens v2 with the same key (D1, another
// device) or at the same address (D2, the same browser) and finds their chats and their
// money. Runs once (in the v2 project), using both apps.
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { drivers } from "../app/drivers";
import { addAccount } from "../app/seed";
import { seal } from "../kit/net";
import { expect, newKey, readyToChat, test } from "./fixtures";

test("D1 the same key opens in v2 with main's chats and balance", async ({
  browser,
  driverName,
  kit,
  appUrl,
}) => {
  test.skip(driverName !== "v2", "uses both apps; runs once");
  const { main, v2 } = drivers;
  const secret = generateSecretKey();
  const nsec = nip19.nsecEncode(secret);
  // chats (kind 1080) are signed by a key derived for sync, so count them all; ecash
  // (NIP-60, kind 7375) is signed by the account's own key, and spent ones are deleted
  const events = async (kind: number, author?: string) =>
    (await kit.relay.events()).filter(
      (e) => e.kind === kind && (!author || e.pubkey === author)
    );
  const chatsBefore = (await events(1080)).length;

  const before = await browser.newContext({ serviceWorkers: "block" });
  await seal(before, kit.env, process.env.KIT_MAIN_URL!);
  const onMain = await before.newPage();
  await readyToChat(
    onMain,
    main,
    process.env.KIT_MAIN_URL!,
    kit.coreUrl,
    await kit.mintToken(200),
    nsec
  );
  const ecashBefore = new Set(
    (await events(7375, getPublicKey(secret))).map((e) => e.id)
  );
  await main.send(onMain, "written in main");
  await main.waitReplyText(onMain, "Echo: written in main");
  await main.waitIdle(onMain);
  // main has published the chat, and the ecash left after paying for it
  await expect
    .poll(async () => (await events(1080)).length, { timeout: 30_000 })
    .toBeGreaterThan(chatsBefore);
  await expect
    .poll(
      async () =>
        (await events(7375, getPublicKey(secret))).some(
          (e) => !ecashBefore.has(e.id)
        ),
      { timeout: 30_000 }
    )
    .toBe(true);
  const mainBalance = Math.floor(await main.balance(onMain));
  await before.close();

  const after = await browser.newContext({ serviceWorkers: "block" });
  await seal(after, kit.env, appUrl);
  const onV2 = await after.newPage();
  await v2.open(onV2, appUrl);
  await v2.signIn(onV2, nsec);
  await v2.waitChats(onV2, 1);
  await expect
    .poll(() => v2.balance(onV2).catch(() => -1), { timeout: 60_000 })
    .toBe(mainBalance);
  // and v2 can spend it: all of it leaves as a token the mint honours
  await v2.useMint(onV2, kit.env.mintUrl);
  expect(await kit.redeem(await v2.makeToken(onV2, mainBalance))).toBe(
    mainBalance
  );
  await after.close();
});

test("D2 main's wallet on this device opens in v2 as its own account's, and only that one's", async ({
  browser,
  driverName,
  kit,
}) => {
  test.skip(driverName !== "v2", "uses both apps; runs once");
  const { main, v2 } = drivers;
  // one address for both apps, so v2 finds what main left in this browser's storage
  const origin = "http://same.localhost";
  let serving = process.env.KIT_MAIN_URL!;
  const context = await browser.newContext({ serviceWorkers: "block" });
  await seal(context, kit.env, origin);
  await context.route(`${origin}/**`, (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: serving + url.pathname + url.search });
  });
  const page = await context.newPage();
  await main.open(page, origin);
  await main.signIn(page, newKey());
  await main.receive(page, await kit.mintToken(40));
  // main also published the coins (NIP-60); without them on the relay, v2 can only find the
  // 40 sats in the browser storage main left
  await kit.relay.reset();

  serving = process.env.KIT_APP_URL!;
  await v2.open(page, origin);
  await expect
    .poll(() => v2.balance(page).catch(() => -1), { timeout: 30_000 })
    .toBe(40);
  // a second key on the device: main's coins stay with the account main had signed in
  await addAccount(page, newKey());
  await v2.ready(page);
  const shows = (sats: number) =>
    expect
      .poll(() => v2.balance(page).catch(() => -1), { timeout: 30_000 })
      .toBe(sats);
  await v2.switchAccount(page);
  await shows(0);
  await v2.switchAccount(page);
  await shows(40);
  await page.reload();
  await v2.ready(page);
  await shows(40);
  await v2.useMint(page, kit.env.mintUrl);
  expect(await kit.redeem(await v2.makeToken(page, 40))).toBe(40);
  await context.close();
});
