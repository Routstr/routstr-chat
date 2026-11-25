// The account menu at the foot of the rail: every key on this device, the one in use ticked,
// a switch that brings each key's own money, Add account, Settings, and the warning before a
// key with sats is removed.
import type { Page } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44 } from "nostr-tools";
import { ROOT_ID, encodeMessage } from "../../features/history/codec";
import { createKeyring, type HistorySigner } from "../../features/history/keyring";
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

/** A chat a key wrote 9 days ago on another device: its history keyring and one question, as its
 *  relays hold them. */
async function oldChat(secret: Uint8Array, words: string) {
  const pubkey = getPublicKey(secret);
  const key = (peer: string) => nip44.v2.utils.getConversationKey(secret, peer);
  const signer: HistorySigner = {
    nip44: {
      encrypt: async (peer, text) => nip44.v2.encrypt(text, key(peer)),
      decrypt: async (peer, text) => nip44.v2.decrypt(text, key(peer)),
    },
    signEvent: async (template) => finalizeEvent(template, secret),
  };
  const at = Math.floor(Date.now() / 1000) - 9 * 86400;
  const ring = await createKeyring(pubkey, signer, at - 60);
  return [ring.event, encodeMessage(words, { role: "user", content: words, _prevId: ROOT_ID }, pubkey, at, ring.keys)];
}

// "Forget chats after 7 days" is the key's own: on in one key, it forgets that key's old chats,
// never another key's on this device, here or on that key's relays
test("forget chats after 7 days, turned on in one key, never forgets another key's chats", async ({ page, context, kit, appUrl }) => {
  const [mine, theirs] = [generateSecretKey(), generateSecretKey()];
  const [myChat, theirChat] = [await oldChat(mine, "my old chat"), await oldChat(theirs, "their old chat")];
  await kit.relay.seed([...myChat, ...theirChat]);
  await seedAccounts(context, [nip19.nsecEncode(mine), nip19.nsecEncode(theirs)]);
  // a deletion on the relays of the chat's question
  const deleted = async (chat: { id: string }[]) =>
    (await kit.relay.events()).some((e) => e.kind === 5 && e.tags.some(([t, id]) => t === "e" && id === chat[1].id));
  const chats = page.getByRole("navigation", { name: "Chats" });

  await v2.open(page, appUrl);
  await expect(chats).toContainText("my old chat", { timeout: 30_000 });
  await chip(page).click();
  await menu(page).getByRole("menuitem", { name: "Settings" }).click();
  await page.locator("#nav-sync").click();
  await page.getByRole("switch", { name: "Forget chats after 7 days" }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await v2.ready(page);
  await expect.poll(() => deleted(myChat), { timeout: 30_000 }).toBe(true);
  await expect(chats).not.toContainText("my old chat");

  await pick(page, 1);
  await v2.loaded(page);
  await expect(chats).toContainText("their old chat", { timeout: 30_000 });
  await page.waitForTimeout(5000);
  await expect(chats).toContainText("their old chat");
  expect(await deleted(theirChat)).toBe(false);
});
