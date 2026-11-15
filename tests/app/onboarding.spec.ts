// First run: the models show with no key, a first send asks only for a first few sats (the
// key is made as they come in), and once they land the held message sends by itself. Its reply
// back, the card asks once to keep that key safe.
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { decrypt } from "nostr-tools/nip49";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedKitProvider } from "./seed";
import { seal } from "../kit/net";
import { envFromProcess } from "../kit/stack";
import type { KitClient } from "../kit";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const sendButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: "Send", exact: true });
const tryCard = (page: Page) =>
  page.getByRole("heading", { name: "Try 100 sats" });
const keepCard = (page: Page) =>
  page.getByRole("heading", { name: "Keep your sats safe" });

/** The key this device made, as it keeps it. */
const madeKey = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem("accounts") || "[]")[0]?.signer?.key as string) ?? "");

/** A first run to the reply of its first paid message: 100 sats as a token, 99 left after. */
async function firstPaidReply(page: Page, kit: KitClient, appUrl: string) {
  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await firstSend(page, "[kit:usage=10,10] hello kit");
  await page.getByRole("radio", { name: /^Cashu/ }).click();
  await page.getByRole("textbox", { name: "Cashu token" }).fill(await kit.mintToken(100));
  await page.getByRole("button", { name: /^Receive/ }).click();
  await v2.waitReplyText(page, "Echo: hello kit");
  await v2.waitIdle(page);
}

async function firstSend(page: Page, text: string) {
  await composer(page).fill(text);
  await sendButton(page).click();
}

test("a first send asks only for 100 sats, then sends by itself", async ({
  page,
  kit,
  appUrl,
}) => {
  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");

  await firstSend(page, "[kit:usage=10,10] hello kit");
  await expect(tryCard(page)).toBeVisible();
  await expect(composer(page)).toHaveValue("[kit:usage=10,10] hello kit");
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
  // with an API key, the default, the change waits on the key until it is returned
  await v2.waitIdle(page);

  // the reply back, the card asks once to keep the key; Later goes back to writing
  await expect(keepCard(page)).toBeVisible();
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await expect(keepCard(page)).toBeHidden();
  await expect(sendButton(page)).toBeVisible();

  await v2.returnCredit(page);
  await expect.poll(() => v2.balance(page), { timeout: 20_000 }).toBe(99);
});

test("the password manager is handed the key, named by its public key, and the key then counts as saved", async ({
  page,
  kit,
  appUrl,
}) => {
  // what the browser's own save sheet is handed (Chrome's API; the sheet itself is the browser's)
  await page.addInitScript(() => {
    const w = window as unknown as { PasswordCredential: unknown; stored: unknown[] };
    w.stored = [];
    w.PasswordCredential = class {
      constructor(public data: { id: string; password: string }) {}
    };
    navigator.credentials.store = async (c) => {
      w.stored.push((c as unknown as { data: unknown }).data);
    };
  });
  await firstPaidReply(page, kit, appUrl);
  await expect(keepCard(page)).toBeVisible();
  await page.getByRole("button", { name: /^Save to password manager/ }).click();
  await page.getByRole("button", { name: "Yes, it is saved" }).click();
  await expect(page.getByRole("heading", { name: "Saved to your password manager" })).toBeVisible();

  const key = hexToBytes(await madeKey(page));
  expect(await page.evaluate(() => (window as unknown as { stored: unknown[] }).stored)).toEqual([
    { id: nip19.npubEncode(getPublicKey(key)), password: nip19.nsecEncode(key), name: "Routstr" },
  ]);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(sendButton(page)).toBeVisible();
  // the wallet no longer asks to back it up
  await page.getByRole("button", { name: /^Open wallet\./ }).first().click();
  await expect(page.getByRole("region", { name: "Wallet", exact: true })).toBeVisible();
  await expect(page.getByText("Back up your key")).toHaveCount(0);
});

test("a password-protected backup file brings the key and its sats back on a new device, with its password only", async ({
  page,
  kit,
  appUrl,
  browser,
}) => {
  await firstPaidReply(page, kit, appUrl);
  await expect(keepCard(page)).toBeVisible();
  await page.getByRole("button", { name: /^Download a backup file/ }).click();
  await page.getByLabel("File password", { exact: true }).fill("correct horse");
  await page.getByLabel("File password again").fill("correct horse");
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file" }).click();
  const download = await saving;
  const text = await readFile(await download.path(), "utf8");
  // saved only once you say you have it
  await page.getByRole("button", { name: "I have the file" }).click();
  await expect(page.getByRole("heading", { name: "Backup file saved" })).toBeVisible();

  // the file holds the key locked (NIP-49), and nothing that opens without the password
  const key = hexToBytes(await madeKey(page));
  expect(text).not.toContain(nip19.nsecEncode(key));
  expect(decrypt(text.match(/ncryptsec1\w+/)![0], "correct horse")).toEqual(key);

  // the wallet's sats are on the relays; this device closes
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const here = await v2.balance(page);
  expect(here).toBeGreaterThan(0);
  await page.context().close();

  // a new device: a wrong password opens nothing, the right one brings the account and its sats
  const context = await browser.newContext();
  await seal(context, envFromProcess()!, appUrl);
  const fresh = await context.newPage();
  await v2.open(fresh, appUrl);
  await fresh.getByRole("button", { name: "Settings", exact: true }).first().click();
  await fresh.locator("#nav-account").click();
  await fresh.getByRole("button", { name: "Sign in", exact: true }).click();
  await fresh.getByRole("button", { name: /^Secret key/ }).click();
  const way = fresh.locator('.pa-way[data-way="key"]');
  await way.locator('input[type="file"]').setInputFiles({ name: download.suggestedFilename(), mimeType: "text/plain", buffer: Buffer.from(text) });
  for (const password of ["wrong horse", "correct horse"]) {
    await fresh.getByLabel("Backup password").fill(password);
    await way.getByRole("button", { name: "Sign in" }).click();
    if (password === "wrong horse") await expect(fresh.getByText("That password does not open it.", { exact: false })).toBeVisible();
  }
  await expect(fresh.getByRole("heading", { name: "You are in" })).toBeVisible();
  await expect.poll(() => v2.balance(fresh).catch(() => -1), { timeout: 60_000 }).toBe(here);
  await context.close();
});

test("with no key the picker lists the models, picking one asks for 100 sats, and signing in there with a key holding none comes back to them", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await composer(page).fill("hello");
  await page.getByRole("main").getByRole("button", { name: /^Model: / }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await picker.getByRole("option", { name: /Kit Echo/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(tryCard(page)).toBeVisible();

  await page.getByRole("button", { name: "Have a key? Sign in", exact: true }).click();
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

test("Esc on the sats card goes back to the draft, still unsent", async ({
  page,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await firstSend(page, "hello");
  await expect(tryCard(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tryCard(page)).toBeHidden();
  await expect(composer(page)).toHaveValue("hello");
  await expect(sendButton(page)).toBeVisible();
});
