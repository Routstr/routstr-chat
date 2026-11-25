// The wallet and accounts the way a person uses them, checked against the mint's answers.
import { getEncodedTokenV4, Mint, Wallet } from "@cashu/cashu-ts";
import { finalizeEvent, generateSecretKey, getPublicKey, nip04, nip19 } from "nostr-tools";
import WebSocket from "ws";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts } from "./seed";
import { seal } from "../kit/net";

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
  // the second mint is listed too, with less than the invoice needs
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

  // the other mint is picked at the foot while Send shows the quote: Pay is still
  // offered, since the quoting mint pays
  const host = new URL(kit.env.invoiceMintUrl).host.replace(/[.]/g, "\\.");
  await page.getByRole("button", { name: /^Mint / }).click();
  const menu = page.getByRole("menu", { name: "Mints" });
  await menu.getByRole("menuitemradio", { name: new RegExp(host) }).click();
  // picking closes the menu: Send stays open with its quote
  await expect(menu).toBeHidden();

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

test("quotes again at the mint picked when the quoting mint cannot cover the invoice, and pays from it", async ({
  page,
  kit,
  appUrl,
}) => {
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(40));
  // the second mint holds too little, and is the one in use
  await v2.receive(page, await kit.mintToken(4, { otherMint: true }));
  await v2.useMint(page, kit.env.invoiceMintUrl);
  // an invoice of a third mint: a kit mint pays its own invoices at once, and
  // then refuses to quote one ("mint quote already paid")
  const other = await kit.walletAt(kit.env.msatMintUrl);
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
  await expect(send.getByText(/^Not enough on/)).toBeVisible({ timeout: 30_000 });
  const pay = send.getByRole("button", { name: /^Pay 8 sats$/ });
  await expect(pay).toBeHidden();

  // the person picks the mint the note names: the invoice is quoted there
  const host = new URL(kit.env.mintUrl).host.replace(/[.]/g, "\\.");
  await page.getByRole("button", { name: /^Mint / }).click();
  const menu = page.getByRole("menu", { name: "Mints" });
  await menu.getByRole("menuitemradio", { name: new RegExp(host) }).click();
  await expect(menu).toBeHidden();
  await pay.click({ timeout: 30_000 });
  await expect(
    send.getByRole("button", { name: "Pay another invoice" })
  ).toBeVisible({ timeout: 30_000 });
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

  // tried again, the invoice is read anew and its fresh quote paid
  await send.getByRole("button", { name: "Try again" }).click();
  await pay.click({ timeout: 30_000 });
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

// an invoice is marked paid only by its own claim: other money of about its size landing
// while it waits (a refund, a token received in another tab) leaves it waiting
test("keeps an invoice waiting while other money of its size lands", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey()]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(10));
  await v2.useMint(page, kit.env.mintUrl);
  // the mint says unpaid each time an invoice is asked about, in every tab
  await context.route("**/v1/mint/quote/bolt11/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), state: "UNPAID" } });
  });

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
  await expect(add.getByText("Waiting for payment")).toBeVisible();

  // 100 sats of other money, received in another tab
  const other = await context.newPage();
  await v2.open(other, appUrl);
  await v2.receive(other, await kit.mintToken(100));
  await expect.poll(() => v2.balance(page), { timeout: 30_000 }).toBe(110);
  await page.waitForTimeout(2_000);
  await expect(add.getByText("Added to your wallet")).toBeHidden();
  await expect(add.getByText("Waiting for payment")).toBeVisible();
});

// an invoice screen that goes away (here with its account) stops asking the mint about its
// invoice: the account's own background checker and recovery claim it whenever it is paid
test("stops asking about an unpaid invoice once its screen is gone", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey(), newKey()]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(10));
  await v2.useMint(page, kit.env.mintUrl);
  // the mint says unpaid each time an invoice is asked about
  await context.route("**/v1/mint/quote/bolt11/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), state: "UNPAID" } });
  });
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
  await expect(add.getByText("Waiting for payment")).toBeVisible();
  // up from Add to the wallet, and from the wallet back to the chats
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Accounts and settings$/ }).first()).toBeVisible();

  await v2.switchAccount(page);
  let asked = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && /\/v1\/mint\/quote\/bolt11\/./.test(r.url())) asked++;
  });
  await page.waitForTimeout(12_000);
  expect(asked).toBe(0);
});

// a gift link holds only the gift's seed, its mint and its message, after the #: opened by hand
// (never on load, so a link scanner takes nothing), a fresh browser asks the mint for the coins
// the seed made and takes them in on a key it makes, and they pay for a reply. The seed travels
// in no request, so neither the server the app is loaded from nor anyone else gets it. Opened
// again in that browser, it says so rather than that someone else took it.
test("a gift link opened by hand in a fresh browser brings its sats, which pay for a reply", async ({
  page,
  context,
  browser,
  kit,
  appUrl,
}) => {
  await kit.upstream.reset();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await v2.open(page, appUrl);
  await v2.fund(page, appUrl, await kit.mintToken(300));
  const link = await v2.giftLink(page, 100, "Mira", "For your exam week.");
  expect(link.startsWith(`${appUrl}/gift#s=`)).toBe(true);
  expect(link.length).toBeLessThan(200);
  await expect.poll(() => v2.balance(page)).toBe(200);
  const seed = new URLSearchParams(new URL(link).hash.slice(1)).get("s") ?? "";

  const friend = await browser.newContext();
  await seal(friend, kit.env, appUrl);
  await friend.addInitScript(
    ({ url, model }) => {
      localStorage.setItem("base_urls_list", JSON.stringify([url]));
      localStorage.setItem("lastUsedModel", JSON.stringify(`${model}@@${url}`));
    },
    { url: kit.coreUrl, model: "kit-cheap" }
  );
  const sent: string[] = [];
  friend.on("request", (r) => sent.push(`${r.url()} ${r.postData() ?? ""}`));
  const second = await friend.newPage();
  await second.goto(link);
  await v2.ready(second);
  await expect(second.getByRole("heading", { name: "Mira sent you a gift." })).toBeVisible();
  // the gift's scene covers the room: its button is the keyboard's way in (named for the light, or for no light)
  const open = second.getByRole("button", { name: /^(Hold to open|Open the gift)$/ });
  await expect(open).toBeVisible();
  await open.press("Enter");
  await expect.poll(() => v2.balance(second).catch(() => 0)).toBe(100);
  expect(new URL(second.url()).hash).toBe("");

  await v2.send(second, "[kit:usage=10,10] hello gift");
  await v2.waitReplyText(second, "Echo: hello gift");
  expect(sent.filter((s) => s.includes(seed))).toEqual([]);

  const again = await friend.newPage();
  await again.goto(link);
  await expect(again.getByRole("heading", { name: "You opened this already." })).toBeVisible();
  await friend.close();
});

// the gift's light cannot start (its worker did not load): the gift opens without it
test("a gift opens when its light cannot load", async ({ page, context, browser, kit, appUrl }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await v2.open(page, appUrl);
  await v2.fund(page, appUrl, await kit.mintToken(300));
  const link = await v2.giftLink(page, 100, "Mira", "For your exam week.");

  const friend = await browser.newContext();
  await seal(friend, kit.env, appUrl);
  await friend.route(/\/_next\/static\/chunks\/.*\.js$/, async (route) => {
    const res = await route.fetch();
    // the light's worker is the one script that can say its light is dead
    if ((await res.text()).includes('t:"dead"')) return route.abort();
    await route.fulfill({ response: res });
  });
  const second = await friend.newPage();
  await second.goto(link);
  await v2.ready(second);
  const open = second.getByRole("button", { name: /^(Hold to open|Open the gift)$/ });
  await expect(open).toBeVisible();
  await open.press("Enter");
  await expect.poll(() => v2.balance(second).catch(() => 0)).toBe(100);
  await friend.close();
});

// one tab's token waits for the wallet while another tab makes one, then its mint refuses it: it
// says it was not made, and never shows the other tab's token as its own
test("a token that cannot be made never shows the one another tab made meanwhile", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await seedAccounts(context, [newKey()]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(25));
  await v2.useMint(page, kit.env.mintUrl);
  const other = await context.newPage();
  await v2.open(other, appUrl);
  await expect.poll(() => v2.balance(other)).toBe(25);
  const swap = `${kit.env.mintUrl.replace(/\/$/, "")}/v1/swap`;

  // the other tab's swap is held at the mint, and with it the wallet
  let letGo = () => {};
  const held = new Promise<void>((go) => (letGo = go));
  let swapping = () => {};
  const atMint = new Promise<void>((go) => (swapping = go));
  await other.route(swap, async (route) => {
    swapping();
    await held;
    await route.continue();
  });
  const theirs = v2.makeToken(other, 5);
  await atMint;

  // this tab asks for 5 meanwhile: it waits for the wallet, then its mint refuses the swap
  await page.route(swap, (route) => route.fulfill({ status: 400, json: { detail: "Refused", code: 11000 } }));
  await page.getByRole("button", { name: /^Open wallet\./ }).first().click();
  await page.getByRole("region", { name: "Wallet", exact: true }).getByRole("button", { name: "Send", exact: true }).click();
  const send = page.getByRole("region", { name: "Send", exact: true });
  await send.getByRole("tab", { name: "Cashu token" }).click();
  await send.getByLabel("Amount in sats").fill("5");
  await send.getByRole("button", { name: "Create token" }).click();
  letGo();
  await theirs;

  await expect(send.getByText("The token could not be made. Nothing left your wallet.")).toBeVisible({ timeout: 30_000 });
  await expect(send.locator(".wl-lnstr code")).toHaveCount(0);
});

/** A Lightning wallet connected by Nostr Wallet Connect, on the kit relay: it pays each invoice it is
 *  asked to (the kit mints' are paid at once) after `ms`, as Lightning takes a moment, and keeps them */
async function nwcWallet(relayUrl: string, ms: number) {
  const key = generateSecretKey();
  const pubkey = getPublicKey(key);
  const paid: string[] = [];
  const ws = new WebSocket(relayUrl);
  await new Promise((open) => ws.once("open", open));
  const publish = (kind: number, content: string, tags: string[][]) =>
    ws.send(JSON.stringify(["EVENT", finalizeEvent({ kind, content, tags, created_at: Math.floor(Date.now() / 1000) }, key)]));
  publish(13194, "pay_invoice get_info get_balance", [["encryption", "nip04"]]);
  ws.send(JSON.stringify(["REQ", "asks", { kinds: [23194], "#p": [pubkey] }]));
  ws.on("message", (data) => {
    const [type, , ask] = JSON.parse(String(data));
    if (type !== "EVENT") return;
    const { method, params } = JSON.parse(nip04.decrypt(key, ask.pubkey, ask.content));
    const answer = (result: object) =>
      publish(23195, nip04.encrypt(key, ask.pubkey, JSON.stringify({ result_type: method, result })), [["p", ask.pubkey], ["e", ask.id]]);
    if (method === "pay_invoice") {
      paid.push(params.invoice);
      setTimeout(() => answer({ preimage: "00".repeat(32) }), ms);
    } else if (method === "get_balance") answer({ balance: 1_000_000 });
    else answer({ alias: "kit", pubkey, network: "regtest", block_height: 1, block_hash: "00", methods: ["pay_invoice", "get_info", "get_balance"] });
  });
  const secret = Buffer.from(generateSecretKey()).toString("hex");
  return { url: `nostr+walletconnect://${pubkey}?relay=wss://nwc.kit.example&secret=${secret}`, paid, close: () => ws.close() };
}

// auto-refill from a connected wallet, with the app open in two tabs: one tab pays, never both
test("auto-refill from a connected wallet pays once, though the app is open in two tabs", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  const wallet = await nwcWallet(kit.env.relayUrl, 4000);
  await seedAccounts(context, [newKey()]);
  await v2.open(page, appUrl);
  await v2.receive(page, await kit.mintToken(50));
  await v2.useMint(page, kit.env.mintUrl);
  // the wallet connected, and 100 more whenever there are fewer than 100
  await page.evaluate((nwcUrl) => {
    localStorage.setItem("bc:config", JSON.stringify({ connectorName: "Kit wallet", connectorType: "nwc.generic", nwcUrl }));
    localStorage.setItem("auto_refill_nwc_settings", JSON.stringify({ enabled: true, threshold: 100, amount: 100 }));
  }, wallet.url);
  await page.reload();
  await v2.ready(page);
  await expect.poll(() => wallet.paid.length, { timeout: 20_000 }).toBe(1);

  // a second tab opens while that payment is on its way
  const other = await context.newPage();
  await v2.open(other, appUrl);
  await expect.poll(() => v2.balance(other), { timeout: 20_000 }).toBe(150);
  await expect.poll(() => v2.balance(page)).toBe(150);
  await other.waitForTimeout(5000);
  expect(wallet.paid.length).toBe(1);
  wallet.close();
});

// the older app kept one history per device: signed out it is no one's to see, and the first key
// that signs in here takes it
test("signed out, the wallet shows no history an older app left on the device, and the first key takes it", async ({ page, context, kit, appUrl }) => {
  const old = { id: "old", direction: "in", amount: "3", timestamp: Date.parse("2026-07-02T16:26:00Z") };
  await context.addInitScript((v) => {
    if (localStorage.getItem("accounts") === null && localStorage.getItem("cashu-history") === null)
      localStorage.setItem("cashu-history", v);
  }, JSON.stringify({ state: { history: [old], pendingTransactions: [] }, version: 0 }));
  await v2.open(page, appUrl);
  await page.getByRole("button", { name: /^Open wallet\./ }).first().click();
  const wallet = page.getByRole("region", { name: "Wallet" }).first();
  await expect(wallet).toContainText("Add sats to start chatting");
  await expect(wallet).not.toContainText("Jul 2");

  await v2.fund(page, appUrl, await kit.mintToken(10));
  await page.getByRole("button", { name: /^Open wallet\./ }).first().click();
  await expect(wallet).toContainText("Jul 2");
});
