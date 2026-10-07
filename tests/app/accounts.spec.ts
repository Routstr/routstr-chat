// The account menu at the foot of the rail: every key on this device, the one in use ticked,
// a switch that brings each key's own money, Add account, Settings, and the warning before a
// key with sats is removed.
import type { Page } from "@playwright/test";
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts, seedKitProvider } from "./seed";

const newKey = () => nip19.nsecEncode(generateSecretKey());
const chip = (page: Page) =>
  page.getByRole("button", { name: /Accounts and settings$/ });
const menu = (page: Page) => page.getByRole("menu", { name: "Accounts" });
const keys = (page: Page) => menu(page).getByRole("menuitemradio");

async function pick(page: Page, i: number) {
  await chip(page).click();
  await keys(page).nth(i).click();
}

test("lists each key, ticks the one in use, and switches with its own money", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey(), newKey()]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(40));

  await chip(page).click();
  await expect(keys(page)).toHaveCount(2);
  await expect(keys(page).nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(keys(page).nth(0)).toContainText("40 sats");
  await expect(keys(page).nth(1)).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(chip(page)).toBeFocused();

  await pick(page, 1);
  await expect.poll(() => v2.balance(page).catch(() => -1)).toBe(0);
  await chip(page).click();
  await expect(keys(page).nth(1)).toHaveAttribute("aria-checked", "true");
  await keys(page).nth(0).click();
  await expect.poll(() => v2.balance(page).catch(() => -1)).toBe(40);
});

test("is reached by keyboard: the key in use takes focus, arrows move, Esc closes", async ({
  page,
  context,
  appUrl,
}) => {
  await seedAccounts(context, [newKey(), newKey()]);
  await v2.open(page, appUrl);
  await chip(page).focus();
  await page.keyboard.press("Enter");
  await expect(keys(page).nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(keys(page).nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu(page).getByRole("menuitem", { name: "Settings" })
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(keys(page).nth(0)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
});

test("adds an account through the sign-in card, and opens Settings", async ({
  page,
  context,
  appUrl,
}) => {
  await seedAccounts(context, [newKey()]);
  await v2.open(page, appUrl);
  await chip(page).click();
  await menu(page).getByRole("menuitem", { name: "Add account" }).click();
  await page.getByRole("button", { name: /^Secret key/ }).click();
  await page.getByLabel("Secret key").fill(newKey());
  await page
    .locator('.pa-way[data-way="key"]')
    .getByRole("button", { name: "Sign in" })
    .click();

  // the new key takes over: the app starts fresh on it
  await chip(page).click();
  await expect(keys(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(keys(page).nth(1)).toHaveAttribute("aria-checked", "true");
  await menu(page).getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("says how many sats a key holds, and that its key was never saved, before removing it", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey(), newKey()]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(40));
  await pick(page, 1);
  await expect.poll(() => v2.balance(page).catch(() => -1)).toBe(0);

  await chip(page).click();
  await menu(page).getByRole("menuitem", { name: "Settings" }).click();
  await page.locator("#nav-account").click();
  const others = page.locator("#g-others");
  await others.getByRole("button", { name: "Remove this key" }).click();
  await expect(others).toContainText("It still holds 40 sats here");
  await expect(others).toContainText("no record of its secret key being saved");

  // signing out of a key with no saved record says so too
  const signOut = page.locator("#g-signout");
  await signOut.getByRole("button", { name: "Sign out" }).first().click();
  await expect(signOut).toContainText(
    "no record of your secret key being saved"
  );
});

test("a switch picked during a reply waits for it, and the reply's change lands in the key that paid", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await kit.upstream.reset();
  await seedAccounts(context, [newKey(), newKey()]);
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.receive(page, await kit.mintToken(300));
  expect(await v2.balance(page)).toBe(300);

  // a slow reply: no new key while it runs; the menu shuts at once, the switch
  // waits for the reply to stop
  await v2.send(page, "[kit:slow=4000] hello kit");
  await chip(page).click();
  const add = menu(page).getByRole("menuitem", { name: /^Add account/ });
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await expect(add).toContainText("When this reply ends");
  await keys(page).nth(1).click();
  await expect(menu(page)).toBeHidden();
  await expect
    .poll(() => v2.balance(page).catch(() => -1), { timeout: 30_000 })
    .toBe(0);

  // back on the first key: what the stopped reply did not spend came back to it
  // (with an API key, the default, it waits on the key until it is returned)
  await pick(page, 0);
  await v2.returnCredit(page);
  await expect
    .poll(() => v2.balance(page).catch(() => -1), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(299);
});
