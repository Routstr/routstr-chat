// Main at / and v2 at /v2 on one address, so one browser storage, the way both will be
// served: both work side by side, each service worker keeps to its own pages, an account's
// coins are the same coins in both and are never spent twice, neither app reloads itself on a
// first visit, and main's purge of week-old files leaves v2's files (and pictures) alone.
import type { Page } from "@playwright/test";
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "../app/fixtures";
import { main } from "../app/drivers/main";
import { v2 } from "../app/drivers/v2";
import { until } from "../app/drivers/wait";
import { seedAccounts, seedKitProvider } from "../app/seed";

const V2 = "/v2/";
const newKey = () => nip19.nsecEncode(generateSecretKey());
// a 1x1 picture
const DOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
// each app's own service worker; main's (scope "/") also covers /v2/ until v2's is installed
const ownWorker = (app: typeof main | typeof v2) =>
  app === v2 ? `${V2}sw.js` : "/sw.js";
const runByOwnWorker = (p: Page, app: typeof main | typeof v2) =>
  p.evaluate(
    (own) =>
      navigator.serviceWorker.controller?.scriptURL ===
      new URL(own, location.href).href,
    ownWorker(app)
  );

/**
 * Until the app's own service worker runs the page, then once more from the top. A build
 * without the fix reloads itself when its worker takes the page over (SWUpdater reloaded on
 * every "controlling", not only on updates), and a step taken just before that is lost; a
 * reload of our own lands a build that does and one that does not in the same place.
 */
async function underWorker(p: Page, app: typeof main | typeof v2) {
  await until(
    () => runByOwnWorker(p, app),
    "the app's service worker to take the page over",
    60_000
  );
  await p.reload();
  await app.ready(p);
}

/** Counts the page's document loads (the first one too; not the app's own route changes). */
function loads(p: Page) {
  const seen = { n: 0 };
  p.on("load", () => seen.n++);
  return seen;
}
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
  await underWorker(page, main);
  await underWorker(two, v2);
  await expect.poll(() => runBy(page)).toBe(`${appUrl}/sw.js`);
  await expect.poll(() => runBy(two)).toBe(`${appUrl}/v2/sw.js`);
});

for (const [name, app, at] of [
  ["main", main, "/"],
  ["v2", v2, V2],
] as const)
  test(`${name}'s first visit is not reloaded when its service worker takes over`, async ({
    page,
    appUrl,
  }) => {
    const seen = loads(page);
    await page.goto(`${appUrl}${at}`);
    await app.ready(page);
    await expect
      .poll(() => runByOwnWorker(page, app), { timeout: 60_000 })
      .toBe(true);
    // the app would reload at once; give it time to
    await page.waitForTimeout(2000);
    expect(seen.n).toBe(1);
  });

test("v2's first visit after main is not reloaded when its own worker takes over from main's", async ({
  page,
  context,
  appUrl,
}) => {
  // main used first: its worker (scope "/") runs v2's first page until v2's own is installed
  await main.open(page, appUrl);
  await expect
    .poll(() => runByOwnWorker(page, main), { timeout: 60_000 })
    .toBe(true);
  const two = await context.newPage();
  const seen = loads(two);
  await v2.open(two, appUrl, V2);
  await expect
    .poll(() => runByOwnWorker(two, v2), { timeout: 60_000 })
    .toBe(true);
  await two.waitForTimeout(2000);
  expect(seen.n).toBe(1);
});

test("signing in on main, then opening v2: the same account and coins, never spent twice", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await main.open(page, appUrl);
  await underWorker(page, main);
  await main.signIn(page, newKey());
  await main.receive(page, await kit.mintToken(100));
  await main.useMint(page, kit.env.mintUrl);

  // v2 opens on main's account with main's 100
  const two = await context.newPage();
  await v2.open(two, appUrl, V2);
  await underWorker(two, v2);
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
  await underWorker(two, v2);
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
  await underWorker(page, main);
  await page
    .locator('input[type="file"][accept="image/*,application/pdf"]')
    .setInputFiles({
      name: "dot.png",
      mimeType: "image/png",
      buffer: DOT,
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

test("a picture v2 sent a week ago is not shown broken after main's purge", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey()]);
  const two = await context.newPage();
  await v2.open(two, appUrl, V2);
  await underWorker(two, v2);
  await seedKitProvider(two, kit.coreUrl, "kit-vision");
  await v2.ready(two);
  await v2.receive(two, await kit.mintToken(50));
  await two
    .locator('main input[type="file"]')
    .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: DOT });
  await v2.send(two, "[kit:usage=10,10] what is in the picture");
  await v2.waitReplyText(two, "Echo:");
  await v2.waitIdle(two);

  // the picture is kept for this account; a week passes
  const owned = await two.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("routstr-files", 1);
        open.onsuccess = () => {
          const tx = open.result.transaction("files", "readwrite");
          const store = tx.objectStore("files");
          let n = 0;
          store.openCursor().onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor) return;
            if (cursor.value.owner) {
              cursor.update({
                ...cursor.value,
                timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
              });
              n++;
            }
            cursor.continue();
          };
          tx.oncomplete = () => (open.result.close(), resolve(n));
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      })
  );
  expect(owned).toBeGreaterThan(0);

  // main opens its file database (a picture attached there) and purges
  await main.open(page, appUrl);
  await underWorker(page, main);
  await page
    .locator('input[type="file"][accept="image/*,application/pdf"]')
    .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: DOT });
  await page.waitForTimeout(3000);

  // what v2 shows for that message now
  await two.reload();
  await v2.ready(two);
  const mine = two.locator("article.rd-me").first();
  await expect(mine).toBeVisible({ timeout: 30_000 });
  await two.waitForTimeout(3000);
  const seen = await mine.evaluate((el) => ({
    text: (el as HTMLElement).innerText,
    images: [...el.querySelectorAll("img")].map((i) => ({
      src: i.src.slice(0, 40),
      loaded: i.complete && i.naturalWidth > 0,
    })),
  }));
  await test.info().attach("what v2 shows", {
    body: JSON.stringify(seen, null, 2),
    contentType: "application/json",
  });
  console.log(`[shared] v2 shows: ${JSON.stringify(seen)}`);
  // never a broken picture: either the picture, or no picture with words saying why
  expect(seen.images.every((i) => i.loaded)).toBe(true);
});
