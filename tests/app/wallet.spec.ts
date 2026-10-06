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

// KNOWN V2 GAP, owned by the wallet thread, pinned as it is today: the paste preview decodes
// without the mint's keysets, and cashu-ts 3.7 cannot read a token whose keyset id is
// new-style ("01…") without them. When the wallet thread fixes it this fails: then expect
// the 30 sats to arrive instead.
test("cannot read a token from a mint with new-style keyset ids (known gap)", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await page
    .getByRole("button", { name: /^Open wallet\./ })
    .first()
    .click();
  await page
    .locator('section[data-v="home"]')
    .getByRole("button", { name: "Add", exact: true })
    .click();
  const add = page.locator('section[data-v="add"]');
  await add.getByRole("tab", { name: "Cashu token" }).click();
  await add
    .getByRole("textbox", { name: "Cashu token" })
    .fill(await kit.mintToken(30, { otherMint: true }));
  await expect(
    add.getByText("That does not look like a Cashu token")
  ).toBeVisible();
  await expect(add.getByRole("button", { name: /^Receive/ })).toBeDisabled();
});
