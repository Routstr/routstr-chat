// The wallet and accounts the way a person uses them, checked against the mint's answers.
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts } from "./seed";

const newKey = () => nip19.nsecEncode(generateSecretKey());

test("receives a pasted token, pays an invoice and makes a token", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  const token = await kit.mintToken(100);
  await v2.receive(page, token);
  expect(await v2.balance(page)).toBe(100);
  await v2.useMint(page, kit.env.mintUrl);
  expect(new Set(await kit.tokenStates(token))).toEqual(new Set(["SPENT"])); // swapped for fresh coins

  await v2.payInvoice(page, await kit.invoice(10));
  const afterPay = await v2.balance(page);
  expect(afterPay).toBeLessThanOrEqual(90); // 10 plus the Lightning fee, if any
  expect(afterPay).toBeGreaterThanOrEqual(88);

  const made = await v2.makeToken(page, 5);
  await expect.poll(() => v2.balance(page)).toBe(afterPay - 5);
  expect(await kit.redeem(made)).toBe(5); // the mint's answer, not the token's own claim
  // and the rest (change from the payment and from the token) is money too, not a number
  const rest = await v2.makeToken(page, afterPay - 5);
  await expect.poll(() => v2.balance(page)).toBe(0);
  expect(await kit.redeem(rest)).toBe(afterPay - 5);
});

test("signs in with a secret key", async ({ page, appUrl }) => {
  await v2.open(page, appUrl);
  await v2.signIn(page, newKey());
  await expect(
    page.getByRole("button", { name: /^Open wallet\. Balance 0 sats/ })
  ).toBeVisible();
});

test("switches between two keys on one device, each with its own money", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey(), newKey()]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(40));
  await v2.switchAccount(page); // to the other key (0 sats) and back (40)
  expect(await v2.balance(page)).toBe(40);
});

// the second mint always serves new-style keyset ids ("01…"), which a token carries short
test("receives a token from the second mint", async ({ page, kit, appUrl }) => {
  await v2.open(page, appUrl);
  const token = await kit.mintToken(30, { otherMint: true });
  await v2.receive(page, token);
  expect(await v2.balance(page)).toBe(30);
  expect(new Set(await kit.tokenStates(token))).toEqual(new Set(["SPENT"]));
});

// each made token is its own record in the wallet book, so a tab that saves after another
// tab made a token cannot write over it
test("keeps a token another tab made when this tab makes one next", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey()]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(50));
  await v2.useMint(page, kit.env.mintUrl);

  const other = await context.newPage();
  await v2.open(other, appUrl);
  await expect.poll(() => v2.balance(other)).toBe(50);
  await v2.makeToken(other, 10);
  // the first tab, which has not seen that token, makes one next
  await v2.makeToken(page, 5);

  await page.reload();
  await v2.ready(page);
  await page
    .getByRole("button", { name: /^Open wallet\./ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: /not claimed yet/ })
  ).toContainText("2 tokens not claimed yet15 sats you can still take back");
});
