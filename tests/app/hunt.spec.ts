// Money bugs hunted the way a person would cause them, on the real app, the kit's real core
// and mints. Every check ends on the mint's answer: what the wallet shows must be money.
import type { BrowserContext, Page } from "@playwright/test";
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts, seedKitProvider } from "./seed";
import type { KitClient } from "../kit/client";

const newKey = () => nip19.nsecEncode(generateSecretKey());
// each paid reply costs well under a sat: core charges at most one per reply
const TINY = "[kit:usage=10,10]";

/** Pays each reply with its own token (main's setting, which v2 reads) instead of an API key. */
const payPerRequest = (context: BrowserContext) =>
  context.addInitScript(() =>
    localStorage.setItem("spendMode", JSON.stringify("x-cashu"))
  );

/** Opens the app on a seeded account (seedAccounts first) with `sats` from the kit mint. */
async function funded(
  page: Page,
  kit: KitClient,
  appUrl: string,
  sats: number
) {
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap", { mainStore: false });
  await v2.receive(page, await kit.mintToken(sats));
  await v2.useMint(page, kit.env.mintUrl);
}

/**
 * After Return in the wallet, `start` less at most a sat per paid reply is in the wallet, the
 * same after a reload, and all of it redeems at the mint. Returns it.
 */
async function addsUp(
  page: Page,
  kit: KitClient,
  start: number,
  replies: number
): Promise<number> {
  await expect
    .poll(
      async () => {
        await v2.returnCredit(page);
        return v2.balance(page);
      },
      { timeout: 60_000 }
    )
    .toBeGreaterThanOrEqual(start - replies);
  const left = await v2.balance(page);
  expect(left).toBeLessThanOrEqual(start);
  await page.reload();
  await v2.ready(page);
  await expect
    .poll(() => v2.balance(page).catch(() => -1), { timeout: 30_000 })
    .toBe(left);
  await v2.useMint(page, kit.env.mintUrl);
  expect(await kit.redeem(await v2.makeToken(page, left))).toBe(left);
  return left;
}

for (const mode of ["API key", "per request"] as const)
  test(`send, stop, try again and edit: the sats add up after Return and a reload (${mode})`, async ({
    page,
    context,
    kit,
    appUrl,
  }) => {
    if (mode === "per request") await payPerRequest(context);
    await seedAccounts(context, [newKey()]);
    await funded(page, kit, appUrl, 300);

    await v2.send(page, `${TINY} one`);
    await v2.waitReplyText(page, "Echo: one");
    await v2.waitIdle(page);

    // stopped while the provider is still working on it, then asked again
    await v2.send(page, `[kit:slow=4000] ${TINY} two`);
    await v2.stop(page);
    await v2.waitIdle(page);
    await page.getByRole("button", { name: "Try again" }).last().click();
    await v2.waitReplyText(page, "Echo: two");
    await v2.waitIdle(page);

    // the first message edited and sent again: a new version, paid again
    const mine = page.locator("article.rd-me").first();
    await mine.hover();
    await mine.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Edit your message" })
      .fill(`${TINY} one again`);
    await page
      .locator(".rd-edit")
      .getByRole("button", { name: "Send" })
      .click();
    await v2.waitReplyText(page, "Echo: one again");
    await v2.waitIdle(page);

    // four requests reached the provider (the stopped one too)
    await addsUp(page, kit, 300, 4);
  });

for (const mode of ["API key", "per request"] as const)
  test(`a reload in the middle of a reply loses no sats (${mode})`, async ({
    page,
    context,
    kit,
    appUrl,
  }) => {
    if (mode === "per request") await payPerRequest(context);
    await seedAccounts(context, [newKey()]);
    await funded(page, kit, appUrl, 300);
    const before = (await kit.upstream.requests()).length;
    await v2.send(page, `[kit:slow=4000] ${TINY} cut short`);
    // paid and on its way to the provider
    await expect
      .poll(async () => (await kit.upstream.requests()).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(before);
    await page.reload();
    await v2.ready(page);
    // whatever the reply was paid with comes back, less a sat at most
    await addsUp(page, kit, 300, 1);
  });

test("a reply running while you switch accounts pays from the account that sent it", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  const [a, b] = [newKey(), newKey()];
  await seedAccounts(context, [a, b]);
  // B holds 50 of its own first
  await v2.open(page, appUrl);
  await v2.switchAccount(page);
  await v2.receive(page, await kit.mintToken(50));
  await v2.switchAccount(page);
  await funded(page, kit, appUrl, 300);

  await v2.send(page, `[kit:slow=4000] ${TINY} from A`);
  await v2.switchAccount(page); // to B, mid-reply
  // B's own money never moves, while A's reply runs and after
  for (let i = 0; i < 8; i++) {
    expect(await v2.balance(page).catch(() => 50)).toBe(50);
    await page.waitForTimeout(500);
  }
  await v2.useMint(page, kit.env.mintUrl);
  expect(await kit.redeem(await v2.makeToken(page, 50))).toBe(50);

  // back on A: its reply was paid from A, and A's sats add up
  await v2.switchAccount(page);
  await addsUp(page, kit, 300, 1);
});

test("two tabs on one account agree on the balance after one of them sends", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey()]);
  await funded(page, kit, appUrl, 300);
  const other = await context.newPage();
  await v2.open(other, appUrl);
  await expect
    .poll(() => v2.balance(other).catch(() => -1), { timeout: 30_000 })
    .toBe(300);

  await v2.send(page, `${TINY} from the first tab`);
  await v2.waitReplyText(page, "Echo: from the first tab");
  await v2.waitIdle(page);
  // settled in the first tab: the credit is back, a sat at most is gone
  await expect
    .poll(
      async () => {
        await v2.returnCredit(page);
        return v2.balance(page);
      },
      { timeout: 60_000 }
    )
    .toBeGreaterThanOrEqual(299);
  const here = await v2.balance(page);

  // the other tab, reloaded, shows the same
  await other.reload();
  await v2.ready(other);
  await expect
    .poll(() => v2.balance(other).catch(() => -1), { timeout: 30_000 })
    .toBe(here);
  await addsUp(other, kit, 300, 1);
});

// the first top-up lands at a mint the provider about to be paid takes (the kit's core takes
// only the kit mint), so the held message can pay from it
test("first run: who's writing, a new account, 100 sats by Lightning, then the held message sends", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap", { mainStore: false });

  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(`${TINY} my first message`);
  await page
    .getByRole("main")
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Who’s writing?" })
  ).toBeVisible();
  await page.getByRole("button", { name: "New account" }).click();
  await expect(
    page.getByRole("heading", { name: "Try 100 sats" })
  ).toBeVisible();
  // Lightning, 100: the kit's FakeWallet pays the invoice at once
  await page.getByRole("radio", { name: "Lightning" }).click();
  await page.locator('.pa-amt[data-n="100"]').click();

  // the sats land and the held message goes, once
  await v2.waitReplyText(page, "Echo: my first message");
  await v2.waitIdle(page);
  await expect(page.locator("article.rd-me")).toHaveCount(1);

  // and the 100 less the reply is money, at the kit mint
  await expect
    .poll(
      async () => {
        await v2.returnCredit(page);
        return v2.balance(page);
      },
      { timeout: 60_000 }
    )
    .toBeGreaterThanOrEqual(99);
  const left = await v2.balance(page);
  expect(await kit.redeem(await v2.makeToken(page, left))).toBe(left);
});

// with no pay mode picked the app pays through an API key (its credit waits at the provider
// until Return), and Settings → Payments names that mode, not per request
test("Settings names the way replies are really paid", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey()]);
  await funded(page, kit, appUrl, 100);
  await v2.send(page, `${TINY} hello`);
  await v2.waitReplyText(page, "Echo: hello");
  await v2.waitIdle(page);
  // paid through an API key: the rest of the deposit waits at the provider
  await page
    .getByRole("button", { name: /^Open wallet\./ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: /^Return [\d,]+ sats to the wallet$/ })
  ).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Accounts and settings$/ }).click();
  await page
    .getByRole("menu", { name: "Accounts" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  await page.locator("#nav-wallet").click();
  await expect(page.locator("#g-paying")).not.toContainText("Per request");
});
