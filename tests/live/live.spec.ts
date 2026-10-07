// The live run, with real money: the final build on this machine, signed in with the API-key
// test account, against the real relays, mints and providers. It spends a few of that
// account's sats, so a person starts it:
//
//   cd <final v2/ui checkout> && node_modules/.bin/next build --webpack   (no kit variables)
//   LIVE_SECRET=<file with an nsec= line> LIVE_APP_OUT=<that checkout>/out \
//     node_modules/.bin/playwright test -c tests/live/playwright.config.ts
//
// LIVE_TOPUP=21 adds a Lightning top-up of 21 sats: the run prints the invoice and waits for
// you to pay it. The secret key is read from the file and typed into the app; it is never
// printed, and this config keeps no traces or screenshots.
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { v2 } from "../app/drivers/v2";
import { serveStatic } from "../kit/services/static";

const nsec = () => {
  const SECRET = process.env.LIVE_SECRET;
  if (!SECRET) throw new Error("set LIVE_SECRET to the test account's secret file");
  const line = fs
    .readFileSync(SECRET, "utf8")
    .split("\n")
    .find((l) => l.startsWith("nsec="));
  if (!line) throw new Error(`no nsec= line in ${SECRET}`);
  return line.slice("nsec=".length).trim();
};

/** Returns what providers hold to the wallet, until nothing is held; the balance then. */
async function settled(page: Page): Promise<number> {
  await expect
    .poll(
      async () => {
        await v2.returnCredit(page);
        return page
          .getByRole("button", { name: /^Return [\d,]+ sats to the wallet$/ })
          .count();
      },
      { timeout: 120_000 }
    )
    .toBe(0);
  return v2.balance(page);
}

/** Sends a one-word question, until its answer is in and the composer is free. */
async function reply(page: Page, text: string) {
  const before = await page.locator(v2.replies).count();
  await v2.send(page, text);
  await expect
    .poll(() => page.locator(v2.replies).count(), { timeout: 120_000 })
    .toBeGreaterThan(before);
  await v2.waitIdle(page);
  await expect(page.locator(v2.replies).last()).toContainText(/ok/i);
}

test("one account, real money: a reply by API key, one by X-Cashu, a top-up, a refund, a reload", async ({
  page,
  context,
}) => {
  const out = process.env.LIVE_APP_OUT;
  if (!out)
    throw new Error("set LIVE_APP_OUT to the final build's out/ folder");
  const server = await serveStatic(path.resolve(out));
  const log = (line: string) => console.log(`[live] ${line}`);
  try {
    await v2.open(page, server.url);
    await v2.signIn(page, nsec());
    await expect
      .poll(() => v2.balance(page).catch(() => -1), { timeout: 120_000 })
      .toBeGreaterThan(0);
    const start = await settled(page);
    log(`start: ${start} sats in the wallet, nothing held at providers`);

    // 1. a short paid reply, API key (the default)
    await reply(page, "Reply with the single word: ok");
    const afterKey = await settled(page);
    log(`API key reply and return: ${start - afterKey} sats spent`);
    expect(start - afterKey).toBeLessThanOrEqual(5);

    // 2. a short paid reply, X-Cashu (main's setting, which v2 reads)
    await page.evaluate(() =>
      localStorage.setItem("spendMode", JSON.stringify("x-cashu"))
    );
    await page.reload();
    await v2.ready(page);
    await reply(page, "Reply with the single word: ok");
    const afterXcashu = await settled(page);
    log(`X-Cashu reply: ${afterKey - afterXcashu} sats spent`);
    expect(afterKey - afterXcashu).toBeLessThanOrEqual(5);
    await page.evaluate(() => localStorage.removeItem("spendMode"));

    // 3. a top-up by Lightning, paid by a person (optional)
    let toppedUp = 0;
    const topUp = Number(process.env.LIVE_TOPUP ?? 0);
    if (topUp > 0) {
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
      await add.getByLabel("Amount in sats").fill(String(topUp));
      await add.getByRole("button", { name: "Create invoice" }).click();
      const code = add.locator(".wl-lnstr code").first();
      await expect(code).toContainText(/^ln/i, { timeout: 60_000 });
      const invoice = await code.textContent();
      log(`pay this ${topUp}-sat invoice from any wallet:\n${invoice}`);
      await expect
        .poll(() => v2.balance(page), {
          timeout: 9 * 60_000,
          intervals: [3000],
        })
        .toBe(afterXcashu + topUp);
      toppedUp = topUp;
      log(`top-up landed: +${topUp}`);
      await page.keyboard.press("Escape");
    }

    // 4. a refund: a fresh API-key deposit, then Return
    await reply(page, "Reply with the single word: ok");
    const afterRefund = await settled(page);
    log(
      `API key reply and refund: ${afterXcashu + toppedUp - afterRefund} sats spent`
    );
    expect(afterXcashu + toppedUp - afterRefund).toBeLessThanOrEqual(5);

    // 5. a reload shows the same balance
    await page.reload();
    await v2.ready(page);
    await expect
      .poll(() => v2.balance(page).catch(() => -1), { timeout: 120_000 })
      .toBe(afterRefund);
    log(
      `after a reload: ${afterRefund} sats. In total ${start + toppedUp - afterRefund} sats spent`
    );
  } finally {
    await server.close();
    await context.close();
  }
});
