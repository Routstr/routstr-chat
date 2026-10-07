// Main at / and v2 at /v2 on one address, so one browser storage, the way both will be
// served: both work side by side, each service worker keeps to its own pages, an account's
// coins are the same coins in both and are never spent twice, and main's purge of week-old
// files leaves v2's files alone.
import type { Page } from "@playwright/test";
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "../app/fixtures";
import { main } from "../app/drivers/main";
import { v2 } from "../app/drivers/v2";

const V2 = "/v2/";
const newKey = () => nip19.nsecEncode(generateSecretKey());
const balance = (p: Page, app: typeof main | typeof v2, sats: number) =>
  expect
    .poll(() => app.balance(p).catch(() => -1), { timeout: 30_000 })
    .toBe(sats);

test("both apps load and work side by side, each under its own service worker", async ({
  page,
  context,
  appUrl,
}) => {
  await main.open(page, appUrl);
  const two = await context.newPage();
  await v2.open(two, appUrl, V2);

  const scopes = (p: Page) =>
    p.evaluate(async () =>
      (await navigator.serviceWorker.getRegistrations())
        .map((r) => r.scope)
        .sort()
    );
  await expect
    .poll(() => scopes(page), { timeout: 30_000 })
    .toEqual([`${appUrl}/`, `${appUrl}/v2/`]);

  // once both are installed, each page is run by its own worker
  const runBy = (p: Page) =>
    p.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  await page.reload();
  await main.ready(page);
  await two.reload();
  await v2.ready(two);
  await expect.poll(() => runBy(page)).toBe(`${appUrl}/sw.js`);
  await expect.poll(() => runBy(two)).toBe(`${appUrl}/v2/sw.js`);
});

test("signing in on main, then opening v2: the same account and coins, never spent twice", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await main.open(page, appUrl);
  await main.signIn(page, newKey());
  await main.receive(page, await kit.mintToken(100));
  await main.useMint(page, kit.env.mintUrl);

  // v2 opens on main's account with main's 100
  const two = await context.newPage();
  await v2.open(two, appUrl, V2);
  await balance(two, v2, 100);
  expect(await two.evaluate(() => localStorage.getItem("activeAccount"))).toBe(
    await page.evaluate(() => localStorage.getItem("activeAccount"))
  );

  // v2 spends 30 of it
  await v2.useMint(two, kit.env.mintUrl);
  expect(await kit.redeem(await v2.makeToken(two, 30))).toBe(30);

  // main, reloaded, has the other 70 and spends all of it: none of v2's 30 among them
  await page.reload();
  await main.ready(page);
  await balance(page, main, 70);
  expect(await kit.redeem(await main.makeToken(page, 70))).toBe(70);

  // and v2 has nothing left either
  await two.reload();
  await v2.ready(two);
  await balance(two, v2, 0);
});

test("main's purge of week-old files leaves v2's files alone", async ({
  page,
  context,
  appUrl,
}) => {
  // a file v2 keeps for an account in the shared file database, saved 8 days ago
  const two = await context.newPage();
  await v2.open(two, appUrl, V2);
  const put = (p: Page, record: { id: string; days: number; owner?: string }) =>
    p.evaluate(
      ({ id, days, owner }) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("routstr-files", 1);
          open.onupgradeneeded = () =>
            open.result
              .createObjectStore("files", { keyPath: "id" })
              .createIndex("by-date", "timestamp");
          open.onsuccess = () => {
            const tx = open.result.transaction("files", "readwrite");
            tx.objectStore("files").put({
              id,
              file: new File(["x"], `${id}.txt`, { type: "text/plain" }),
              timestamp: Date.now() - days * 24 * 60 * 60 * 1000,
              ...(owner ? { owner } : {}),
            });
            tx.oncomplete = () => (open.result.close(), resolve());
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        }),
      record
    );
  const ids = (p: Page) =>
    p.evaluate(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open("routstr-files", 1);
          open.onsuccess = () => {
            const all = open.result
              .transaction("files")
              .objectStore("files")
              .getAllKeys();
            all.onsuccess = () => (
              open.result.close(),
              resolve((all.result as string[]).sort())
            );
          };
          open.onerror = () => reject(open.error);
        })
    );
  await put(two, { id: "v2-file", days: 8, owner: "a".repeat(64) });

  // main opens its file database (attaching a picture saves it there) and purges
  await main.open(page, appUrl);
  await page
    .locator('input[type="file"][accept="image/*,application/pdf"]')
    .setInputFiles({
      name: "dot.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      ),
    });
  // main's own picture is in: its database opened, and with that its purge ran
  await expect
    .poll(async () => (await ids(page)).some((id) => id !== "v2-file"), {
      timeout: 30_000,
    })
    .toBe(true);
  await page.waitForTimeout(2000);
  expect(await ids(page)).toContain("v2-file");
});
