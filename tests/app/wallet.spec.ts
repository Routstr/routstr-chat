// The wallet and accounts the way a person uses them, checked against the mint's answers.
import { getEncodedTokenV4, Mint, Wallet } from "@cashu/cashu-ts";
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
  // the other key holds nothing; back on this key, its 40 again, also after a reload
  const shows = (sats: number) =>
    expect
      .poll(() => v2.balance(page).catch(() => -1), { timeout: 30_000 })
      .toBe(sats);
  await v2.switchAccount(page);
  await shows(0);
  await v2.switchAccount(page);
  await shows(40);
  await page.reload();
  await v2.ready(page);
  await shows(40);
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

test("pays the invoice Add hands over, never one quoted before", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(50));
  await v2.useMint(page, kit.env.mintUrl);
  const home = page.getByRole("region", { name: "Wallet", exact: true });
  const send = page.getByRole("region", { name: "Send", exact: true });
  const add = page.getByRole("region", { name: "Add funds", exact: true });

  // Send quotes an invoice for 20, and the person leaves without paying it
  await page
    .getByRole("button", { name: /^Open wallet\./ })
    .first()
    .click();
  await home.getByRole("button", { name: "Send", exact: true }).click();
  await send.getByRole("tab", { name: "Lightning" }).click();
  const field = send.getByRole("textbox", { name: "Lightning invoice" });
  await field.fill(await kit.invoice(20));
  await field.press("Enter");
  await expect(send.getByRole("button", { name: /^Pay 20 sats$/ })).toBeVisible(
    { timeout: 30_000 }
  );
  await page.getByRole("button", { name: "Back to wallet" }).first().click();

  // Add gets an invoice for 8 pasted and hands it to Send
  await home.getByRole("button", { name: "Add", exact: true }).click();
  await add.getByRole("tab", { name: "Cashu token" }).click();
  await add
    .getByRole("textbox", { name: "Cashu token" })
    .fill(await kit.invoice(8));
  await add.getByRole("button", { name: "Pay this invoice instead" }).click();
  await send
    .getByRole("button", { name: /^Pay 8 sats$/ })
    .click({ timeout: 30_000 });
  await expect(
    send.getByRole("button", { name: "Pay another invoice" })
  ).toBeVisible({ timeout: 30_000 });
  // 8 left the wallet (and the network's fee, if any), not 20
  await expect.poll(() => v2.balance(page)).toBeGreaterThanOrEqual(40);
});

test("shows and pays an invoice in sats at a mint that counts in msat", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  const mint = new Wallet(new Mint(kit.env.msatMintUrl), { unit: "msat" });
  await mint.loadMint();
  const quote = await mint.createMintQuote(50_000);
  await expect
    .poll(async () => (await mint.checkMintQuote(quote.quote)).state)
    .toBe("PAID");
  const proofs = await mint.mintProofs(50_000, quote.quote);
  await v2.receive(
    page,
    getEncodedTokenV4({ mint: kit.env.msatMintUrl, unit: "msat", proofs })
  );
  await v2.useMint(page, kit.env.msatMintUrl);
  expect(await v2.balance(page)).toBe(50);

  // the invoice is for 8 sats: Send says 8, not 8,000, and does not say "not enough"
  await page
    .getByRole("button", { name: /^Open wallet\./ })
    .first()
    .click();
  await page
    .getByRole("region", { name: "Wallet", exact: true })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  const send = page.getByRole("region", { name: "Send", exact: true });
  await send.getByRole("tab", { name: "Lightning" }).click();
  const field = send.getByRole("textbox", { name: "Lightning invoice" });
  await field.fill(await kit.invoice(8));
  await field.press("Enter");
  await send
    .getByRole("button", { name: "Pay 8 sats" })
    .click({ timeout: 30_000 });
  await expect(
    send.getByRole("button", { name: "Pay another invoice" })
  ).toBeVisible({ timeout: 30_000 });
  const left = await v2.balance(page);
  expect(left).toBeLessThanOrEqual(42);
  expect(left).toBeGreaterThanOrEqual(41); // the network may keep a few msat
});

test("adds by Lightning at a mint that counts in msat, as many sats as asked", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  // a small token first, so the wallet lists the msat mint
  const mint = new Wallet(new Mint(kit.env.msatMintUrl), { unit: "msat" });
  await mint.loadMint();
  const quote = await mint.createMintQuote(10_000);
  await expect
    .poll(async () => (await mint.checkMintQuote(quote.quote)).state)
    .toBe("PAID");
  const proofs = await mint.mintProofs(10_000, quote.quote);
  await v2.receive(
    page,
    getEncodedTokenV4({ mint: kit.env.msatMintUrl, unit: "msat", proofs })
  );
  await v2.useMint(page, kit.env.msatMintUrl);
  expect(await v2.balance(page)).toBe(10);

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
  await add.getByRole("textbox", { name: "Amount in sats" }).fill("100");
  await add.getByRole("button", { name: "Create invoice" }).click();
  // the kit's FakeWallet pays it at once: 100 sats land, not a tenth of one
  await expect
    .poll(() => v2.balance(page), { timeout: 60_000 })
    .toBe(110);
});

test("pays an invoice at the mint that quoted it, though another mint is picked before Pay", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(40));
  // the second mint is listed too
  await v2.receive(page, await kit.mintToken(8, { otherMint: true }));
  await v2.useMint(page, kit.env.mintUrl);
  const other = await kit.walletAt(kit.env.invoiceMintUrl);
  const invoice = await other.createMintQuote(8);

  await page
    .getByRole("button", { name: /^Open wallet\./ })
    .first()
    .click();
  await page
    .getByRole("region", { name: "Wallet", exact: true })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  const send = page.getByRole("region", { name: "Send", exact: true });
  await send.getByRole("tab", { name: "Lightning" }).click();
  const field = send.getByRole("textbox", { name: "Lightning invoice" });
  await field.fill(invoice.request);
  await field.press("Enter");
  const pay = send.getByRole("button", { name: /^Pay 8 sats$/ });
  await expect(pay).toBeVisible({ timeout: 30_000 });

  // the other mint is picked at the foot while Send shows the quote
  const host = new URL(kit.env.invoiceMintUrl).host.replace(/[.]/g, "\\.");
  await page.getByRole("button", { name: /^Mint / }).click();
  await page
    .getByRole("menu", { name: "Mints" })
    .getByRole("menuitemradio", { name: new RegExp(host) })
    .click();
  await page.keyboard.press("Escape");

  await pay.click();
  await expect(
    send.getByRole("button", { name: "Pay another invoice" })
  ).toBeVisible({ timeout: 30_000 });
  // paid by the mint that made the quote: the invoice is settled
  await expect
    .poll(async () => (await other.checkMintQuote(invoice.quote)).state, {
      timeout: 20_000,
    })
    .toBe("PAID");
});

test("pays an invoice on a second press, after the first payment did not go through", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(40));
  await v2.useMint(page, kit.env.mintUrl);
  const other = await kit.walletAt(kit.env.invoiceMintUrl);
  const invoice = await other.createMintQuote(8);
  // the first payment does not go through: the mint answers that its quote is still unpaid
  let failed = false;
  await page.route(`${kit.env.mintUrl}/v1/melt/bolt11`, async (route) => {
    if (failed) return route.fallback();
    failed = true;
    const { quote } = route.request().postDataJSON() as { quote: string };
    const unpaid = await page.request.get(
      `${kit.env.mintUrl}/v1/melt/quote/bolt11/${quote}`
    );
    await route.fulfill({ json: await unpaid.json() });
  });

  await page
    .getByRole("button", { name: /^Open wallet\./ })
    .first()
    .click();
  await page
    .getByRole("region", { name: "Wallet", exact: true })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  const send = page.getByRole("region", { name: "Send", exact: true });
  await send.getByRole("tab", { name: "Lightning" }).click();
  const field = send.getByRole("textbox", { name: "Lightning invoice" });
  await field.fill(invoice.request);
  await field.press("Enter");
  const pay = send.getByRole("button", { name: /^Pay 8 sats$/ });
  await pay.click({ timeout: 30_000 });
  await expect(send.getByText(/did not finish/)).toBeVisible({
    timeout: 30_000,
  });
  expect(failed).toBe(true);

  // tried again, it pays
  await send.getByRole("button", { name: "Try again" }).click();
  await expect(
    send.getByRole("button", { name: "Pay another invoice" })
  ).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await other.checkMintQuote(invoice.quote)).state, {
      timeout: 20_000,
    })
    .toBe("PAID");
});

test("lands a token whose swap answer never arrives, and says it was added", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  let lost = false;
  await page.route(`${kit.env.mintUrl}/v1/swap`, async (route) => {
    if (lost) return route.fallback();
    lost = true;
    await route.fetch(); // the mint swaps the token
    await route.abort("failed"); // and its answer never reaches the app
  });
  const token = await kit.mintToken(30);
  await v2.receive(page, token);
  expect(lost).toBe(true);
  expect(await v2.balance(page)).toBe(30);
  expect(new Set(await kit.tokenStates(token))).toEqual(new Set(["SPENT"]));
});
