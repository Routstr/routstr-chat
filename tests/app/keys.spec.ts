// API keys in Settings move real money: a key is made from the wallet's own sats, it is still
// there after a reload, and emptying it brings those sats back to the wallet.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedKitProvider } from "./seed";

const keysGroup = (page: Page) => page.locator("#g-keys");
const row = (page: Page, name: string) =>
  keysGroup(page).locator(".st-it", { hasText: name });

/** The account menu → Settings → API keys. */
async function openKeys(page: Page) {
  await page.getByRole("button", { name: /Accounts and settings$/ }).click();
  await page
    .getByRole("menu", { name: "Accounts" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  await page.locator("#nav-keys").click();
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
}

const wallet = (page: Page) => v2.balance(page).catch(() => -1);
// the rail, where the balance shows, is behind the Settings layer
async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
}

test("funds a key from the wallet, keeps it through a reload, and empties it back", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap", { mainStore: false });
  await v2.fund(page, appUrl, await kit.mintToken(100));
  await expect.poll(() => wallet(page)).toBe(100);

  // 1. a key with 30 of the wallet's sats on it
  await openKeys(page);
  await keysGroup(page).getByRole("button", { name: "Make a key" }).click();
  await keysGroup(page).getByLabel("Key name").fill("laptop");
  await keysGroup(page).getByLabel("Sats to put on the key").fill("30");
  await keysGroup(page).getByRole("button", { name: "Make key" }).click();
  await expect(row(page, "laptop")).toContainText("30 sats", {
    timeout: 30_000,
  });
  await closeSettings(page);
  await expect.poll(() => wallet(page)).toBe(70);

  // 2. a reload keeps the key and its balance
  await page.reload();
  await v2.ready(page);
  await expect.poll(() => wallet(page)).toBe(70);
  await openKeys(page);
  await expect(row(page, "laptop")).toContainText("30 sats");

  // 3. emptied back: the wallet gets the sats, the key leaves the list
  await row(page, "laptop").getByRole("button", { name: "Remove" }).click();
  await keysGroup(page)
    .locator("#f-rm-0")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(row(page, "laptop")).toHaveCount(0, { timeout: 30_000 });
  await closeSettings(page);
  // the 30 come back, less the provider's refund fee, if any
  await expect
    .poll(() => wallet(page), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(98);
  const back = await wallet(page);
  expect(back).toBeLessThanOrEqual(100);

  // and it stays settled after another reload: the sats stay, the key stays gone
  await page.reload();
  await v2.ready(page);
  await expect.poll(() => wallet(page)).toBe(back);
  await openKeys(page);
  await expect(keysGroup(page)).toContainText("No keys yet");
});
