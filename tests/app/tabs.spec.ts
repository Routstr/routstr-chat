// Two tabs of one browser share one list of keys: a guest tab's top-up never drops the key
// another tab made for a ?cashu= link, nor the coins on it, whether or not the guest tab heard.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";

type Stored = { id: string; pubkey: string; signer?: unknown };
const mirror = (page: Page): Promise<Stored[]> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("accounts") || "[]"));
// the copy in IndexedDB, which a main tab's sign-out cannot wipe
const saved = (page: Page): Promise<Stored[]> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const o = indexedDB.open("routstr-chat-session");
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error);
    });
    const v = await new Promise<string | undefined>((res, rej) => {
      const r = db.transaction("saved").objectStore("saved").get("accounts");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return JSON.parse(v || "[]");
  });

/** Wallet → Add → Lightning → Create invoice: makes a key first if the tab has none. */
async function topUp(page: Page, sats: number) {
  await page
    .getByRole("button", { name: /^Open wallet\./ })
    .first()
    .click();
  await page
    .getByRole("region", { name: "Wallet", exact: true })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  const add = page.getByRole("region", { name: "Add funds", exact: true });
  await add.getByRole("tab", { name: "Lightning" }).click();
  await add.getByLabel("Amount in sats").fill(String(sats));
  await add.getByRole("button", { name: "Create invoice" }).click();
}

for (const heard of [true, false]) {
  test(`a guest tab's top-up keeps the key another tab made, and its coins (${heard ? "heard" : "not heard"})`, async ({
    page,
    context,
    kit,
    appUrl,
  }) => {
    // not heard: tab 1's app never sees a storage event, as if it came too late
    if (!heard)
      await page.addInitScript(() =>
        window.addEventListener(
          "storage",
          (e) => e.stopImmediatePropagation(),
          true
        )
      );
    await v2.open(page, appUrl);
    expect(await mirror(page)).toEqual([]);

    const tab2 = await context.newPage();
    await v2.fund(tab2, appUrl, await kit.mintToken(40));
    const [k1] = await mirror(tab2);

    await page.bringToFront();
    await topUp(page, 21);
    // both copies keep K1 and its secret key
    for (const copy of [mirror, saved])
      await expect
        .poll(
          async () => (await copy(page)).find((a) => a.id === k1.id)?.signer
        )
        .toEqual(k1.signer);

    // a fresh start opens K1 with its coins
    await tab2.close();
    await page.close();
    const again = await context.newPage();
    await v2.open(again, appUrl);
    if (
      (await again.evaluate(() => localStorage.getItem("activeAccount"))) !==
      k1.id
    ) {
      await again
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
      await again.locator("#nav-account").click();
      await again
        .locator("#g-others")
        .getByRole("button", { name: "Switch" })
        .first()
        .click();
    }
    await expect
      .poll(() => v2.balance(again).catch(() => -1), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(40);
  });
}
