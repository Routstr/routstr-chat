// First run: a first send asks who is writing, then for a first few sats, and once they land
// the held message sends by itself.
import type { Page } from "@playwright/test";
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedKitProvider } from "./seed";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const sendButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: "Send", exact: true });
const who = (page: Page) =>
  page.getByRole("heading", { name: "Who’s writing?" });
const tryCard = (page: Page) =>
  page.getByRole("heading", { name: "Try 100 sats" });

async function firstSend(page: Page, text: string) {
  await composer(page).fill(text);
  await sendButton(page).click();
}

test("a first send asks who's writing, then for 100 sats, then sends by itself", async ({
  page,
  kit,
  appUrl,
}) => {
  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");

  await firstSend(page, "[kit:usage=10,10] hello kit");
  await expect(who(page)).toBeVisible();
  await expect(composer(page)).toHaveValue("[kit:usage=10,10] hello kit");

  await expect(page.getByRole("button", { name: "New account" })).toBeFocused();
  await page.getByRole("button", { name: "New account" }).click();
  await expect(tryCard(page)).toBeVisible();
  await expect(page.locator('.pa-amt[data-n="100"]')).toHaveAttribute(
    "data-picked",
    ""
  );

  // the first sats as a token: they land, the card closes, the message goes
  await page.getByRole("radio", { name: /^Cashu/ }).click();
  await page
    .getByRole("textbox", { name: "Cashu token" })
    .fill(await kit.mintToken(100));
  await page.getByRole("button", { name: /^Receive/ }).click();
  await v2.waitReplyText(page, "Echo: hello kit");
  // with an API key, the default, the reply's change waits on the key until it is returned
  await v2.returnCredit(page);
  await expect.poll(() => v2.balance(page), { timeout: 20_000 }).toBe(99);
});

test("signing in answers who's writing, and a key with no sats goes on to 100 sats", async ({
  page,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await firstSend(page, "hello");
  await expect(who(page)).toBeVisible();

  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /^Secret key/ }).click();
  await page
    .getByLabel("Secret key")
    .fill(nip19.nsecEncode(generateSecretKey()));
  await page
    .locator('.pa-way[data-way="key"]')
    .getByRole("button", { name: "Sign in" })
    .click();
  await expect(tryCard(page)).toBeVisible({ timeout: 30_000 });
  await expect(composer(page)).toHaveValue("hello");
});

test("Esc on who's writing goes back to the draft, still unsent", async ({
  page,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await firstSend(page, "hello");
  await expect(who(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(who(page)).toBeHidden();
  await expect(composer(page)).toHaveValue("hello");
  await expect(sendButton(page)).toBeVisible();
});
