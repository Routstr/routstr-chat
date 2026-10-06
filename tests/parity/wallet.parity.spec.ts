// Parity, money: the wallet does the same thing in both apps, checked at the mint.
import { getTokenMetadata } from "@cashu/cashu-ts";
import { expect, newKey, test } from "./fixtures";
import type { Driver } from "../app/drivers";
import type { KitClient } from "../kit/client";

/** The balance is money, not a number: all of it leaves as a token the mint honours. */
async function spendable(
  page: Parameters<Driver["open"]>[0],
  driver: Driver,
  kit: KitClient,
  sats: number,
  mint: string
) {
  await driver.useMint(page, mint);
  expect(await kit.redeem(await driver.makeToken(page, sats))).toBe(sats);
}

// first: a token from a mint whose keysets have the new-style ids ("01…", as nutshell 0.20
// and Minibits now have). cashu-ts can only read those with the mint's keyset list.
test("W1b receive a pasted token from a mint with new-style keyset ids", async ({
  page,
  driver,
  kit,
  appUrl,
}) => {
  await driver.open(page, appUrl);
  await driver.signIn(page, newKey());
  const token = await kit.mintToken(120, { otherMint: true });
  await driver.receive(page, token);
  await expect.poll(() => driver.balance(page)).toBe(120);
  expect(new Set(await kit.tokenStates(token))).toEqual(new Set(["SPENT"]));
  await spendable(page, driver, kit, 120, getTokenMetadata(token).mint);
});

test("W1a receive a pasted token", async ({ page, driver, kit, appUrl }) => {
  await driver.open(page, appUrl);
  await driver.signIn(page, newKey());
  const token = await kit.mintToken(120);
  await driver.receive(page, token);
  await expect.poll(() => driver.balance(page)).toBe(120);
  expect(new Set(await kit.tokenStates(token))).toEqual(new Set(["SPENT"]));
  await spendable(page, driver, kit, 120, kit.env.mintUrl);
});

test("W2 A3 a ?cashu= link funds a new visitor and makes a key", async ({
  page,
  driver,
  kit,
  appUrl,
}) => {
  const token = await kit.mintToken(70);
  await driver.fundByLink(page, appUrl, token);
  await expect.poll(() => driver.balance(page)).toBe(70);
  expect(new Set(await kit.tokenStates(token))).toEqual(new Set(["SPENT"]));
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("accounts") || "[]").length
    )
  ).toBe(1);
  await spendable(page, driver, kit, 70, kit.env.mintUrl);
});

test("W3 pay a Lightning invoice", async ({ page, driver, kit, appUrl }) => {
  await driver.open(page, appUrl);
  await driver.signIn(page, newKey());
  await driver.receive(page, await kit.mintToken(100));
  await driver.useMint(page, kit.env.mintUrl);
  await driver.payInvoice(page, await kit.invoice(10));
  const left = await driver.balance(page);
  expect(left).toBeLessThanOrEqual(90); // 10 plus a Lightning fee within the reserve
  expect(left).toBeGreaterThanOrEqual(88);
  // the change from the payment is money, not just a number: all of it redeems
  expect(await kit.redeem(await driver.makeToken(page, left))).toBe(left);
});

test("W4 make an ecash token the mint honours", async ({
  page,
  driver,
  kit,
  appUrl,
}) => {
  await driver.open(page, appUrl);
  await driver.signIn(page, newKey());
  await driver.receive(page, await kit.mintToken(60));
  await driver.useMint(page, kit.env.mintUrl);
  const token = await driver.makeToken(page, 7);
  await expect.poll(() => driver.balance(page)).toBe(53);
  expect(await kit.redeem(token)).toBe(7); // the mint's answer, not the token's own claim
});
