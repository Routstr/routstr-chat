// A device that took its coins from relays makes an API-key reply and returns all credit; core
// then holds nothing for its key, and a fresh device of the same account sees the same sats.
// The live run read its balance while Return still showed "Returning" and closed the browser.
import type { Browser, Page } from "@playwright/test";
import { generateSecretKey, getPublicKey, nip19, nip44 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts, seedKitProvider } from "./seed";
import { PROVIDER_ALIAS, seal } from "../kit/net";
import { envFromProcess } from "../kit/stack";
import type { KitClient } from "../kit";

const TINY = "[kit:usage=10,10]";
const env = envFromProcess()!;

async function device(browser: Browser, appUrl: string, nsec: string, coreUrl: string) {
  const context = await browser.newContext();
  await seal(context, env, appUrl);
  await seedAccounts(context, [nsec]);
  const page = await context.newPage();
  await v2.open(page, appUrl);
  await seedKitProvider(page, coreUrl, "kit-cheap");
  return { context, page };
}

const balanceSoon = (page: Page) => v2.balance(page).catch(() => -1);

/** The provider keys the account's relay backup lists (main's kind 30078). */
async function backedUpKeys(kit: KitClient, secret: Uint8Array) {
  const pubkey = getPublicKey(secret);
  const latest = (await kit.relay.events())
    .filter((e) => e.kind === 30078 && e.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest) return [];
  const key = nip44.v2.utils.getConversationKey(secret, pubkey);
  return JSON.parse(nip44.v2.decrypt(latest.content, key)) as {
    baseUrl: string;
    key: string;
  }[];
}

/** What core holds for a key, in msat (the app reaches it by the kit's alias). */
async function atCore(kit: KitClient, { baseUrl, key }: { baseUrl: string; key: string }) {
  const base = baseUrl === PROVIDER_ALIAS ? kit.coreUrl : baseUrl;
  const res = await fetch(`${base}v1/wallet/info`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return ((await res.json()) as { balance: number }).balance;
}

test("a fresh device sees what an API-key reply and Return left", async ({
  browser,
  page,
  context,
  kit,
  appUrl,
}) => {
  const secret = generateSecretKey();
  const nsec = nip19.nsecEncode(secret);
  const pubkey = getPublicKey(secret);
  await seedAccounts(context, [nsec]);
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.receive(page, await kit.mintToken(300));
  await v2.useMint(page, kit.env.mintUrl);
  await expect
    .poll(async () => (await kit.relay.events()).filter((e) => e.kind === 7375 && e.pubkey === pubkey).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await context.close();

  // a second device: its coins only from relays
  const b = await device(browser, appUrl, nsec, kit.coreUrl);
  await expect.poll(() => balanceSoon(b.page), { timeout: 60_000 }).toBe(300);
  await v2.useMint(b.page, kit.env.mintUrl);
  await v2.send(b.page, `${TINY} one`);
  await v2.waitReplyText(b.page, "Echo: one");
  await v2.waitIdle(b.page);
  // the reply's key, as its backup lists it, holds the deposit at core
  await expect.poll(async () => (await backedUpKeys(kit, secret)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const used = await backedUpKeys(kit, secret);
  await expect
    .poll(
      async () => {
        await v2.returnCredit(b.page);
        return b.page.getByRole("button", { name: /^Return [\d,]+ sats to the wallet$/ }).count();
      },
      { timeout: 60_000 }
    )
    .toBe(0);
  // Return paid out every key: core holds nothing for any of them
  for (const key of used) expect(await atCore(kit, key)).toBe(0);
  const left = await v2.balance(b.page);
  console.log(`[loss] device two after the reply and Return: ${left}`);
  await b.context.close();

  // a third device, at once
  const c = await device(browser, appUrl, nsec, kit.coreUrl);
  await expect.poll(() => balanceSoon(c.page), { timeout: 60_000 }).toBeGreaterThan(0);
  await c.page.waitForTimeout(5000);
  const seen = await v2.balance(c.page);
  console.log(`[loss] device three sees: ${seen}`);
  expect(left).toBeGreaterThanOrEqual(299);
  expect(seen).toBe(left);
  await c.context.close();
});
