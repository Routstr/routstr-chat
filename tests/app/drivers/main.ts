// How a person uses main (the current app, commit 4a0dd2d), for baselines and parity. Every
// step returns once the person would see its result.
import { expect, type Page } from "@playwright/test";

const composer = (page: Page) =>
  page.locator('textarea[data-tutorial="chat-input"]');
// the header balance: "300.00 sats", "loading", or "Node"; anchored so it skips "N sats provider credit"
const balanceButton = (page: Page) =>
  page.getByRole("button", { name: /^\d+(\.\d+)? sats$/ }).first();
const replies = (page: Page) =>
  page.locator(".flex.flex-col.items-start.mb-6 > .w-full.text-foreground");
const lastReply = (page: Page) => replies(page).last();
const popover = (page: Page) => page.getByRole("dialog").last();

/**
 * The top-up prompt opens by itself half a second after the app sees a zero balance; once
 * closed it stays closed for the page's life. `wait` gives it time to appear (ready() does
 * that once per page load, so timed steps never wait for it).
 */
async function dismissTopUp(page: Page, wait = false) {
  const prompt = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Top up" }) });
  const shown = wait
    ? await prompt.waitFor({ state: "visible", timeout: 2500 }).then(
        () => true,
        () => false
      )
    : await prompt.isVisible();
  if (shown) await prompt.getByRole("button", { name: "Close" }).click();
  await expect(prompt).toBeHidden();
}

async function openBalance(page: Page, tab: "Receive" | "Send") {
  await dismissTopUp(page);
  await balanceButton(page).click();
  await popover(page)
    .getByRole("button", { name: tab, exact: true })
    .first()
    .click();
}

async function openSettings(page: Page) {
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  if (await expand.isVisible()) await expand.click();
  await page.locator('[data-tutorial="settings-button"]').click();
}

export const main = {
  name: "main",

  /** Until the loader has gone and the message box shows. */
  async open(page: Page, appUrl: string) {
    await page.goto(appUrl);
    await main.ready(page);
  },

  async loaded(page: Page) {
    await expect(composer(page)).toBeVisible({ timeout: 30_000 });
  },

  async ready(page: Page) {
    await main.loaded(page);
    if (!((await main.balance(page).catch(() => 0)) > 0))
      await dismissTopUp(page, true);
  },

  async balance(page: Page): Promise<number> {
    const name =
      (await balanceButton(page).textContent({ timeout: 2000 })) ?? "";
    return parseFloat(name);
  },

  /** The header's (or the top-up prompt's) Sign in → Private key → Sign In. */
  async signIn(page: Page, nsec: string) {
    const prompt = page.getByRole("dialog");
    if (await prompt.isVisible())
      await prompt
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
    else
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator("#login-nsec").fill(nsec);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign In", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /^(\d+(\.\d+)? sats|loading)$/ })
    ).toBeVisible({ timeout: 30_000 });
    await dismissTopUp(page);
  },

  /** Balance → Receive → Token → Import Token, until it says received. */
  async receive(page: Page, token: string) {
    await openBalance(page, "Receive");
    await popover(page)
      .getByRole("button", { name: "Token", exact: true })
      .click();
    await page.getByPlaceholder("Paste a Cashu token here...").fill(token);
    await page.getByRole("button", { name: "Import Token" }).click();
    await expect(
      page.getByText(/^Received [\d,.]+ sats successfully!$/)
    ).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
  },

  /** Balance → the mint picker at the top → that mint. */
  async useMint(page: Page, mintUrl: string) {
    const host = new URL(mintUrl).host;
    await dismissTopUp(page);
    await balanceButton(page).click();
    const picker = popover(page)
      .locator("button[title]")
      .filter({ hasText: /./ })
      .first();
    if ((await picker.getAttribute("title")) !== mintUrl) {
      await picker.click();
      await popover(page)
        .getByRole("button", { name: new RegExp(host.replace(/[.]/g, "\\.")) })
        .first()
        .click();
      await expect(picker).toHaveAttribute("title", mintUrl);
    }
    await page.keyboard.press("Escape");
  },

  /** Balance → Send → Lightning → Pay Invoice, until it says paid. */
  async payInvoice(page: Page, bolt11: string) {
    await openBalance(page, "Send");
    await popover(page)
      .getByRole("button", { name: "Lightning", exact: true })
      .click();
    await page.getByPlaceholder("Paste lightning invoice here...").fill(bolt11);
    await expect(page.getByText("Invoice Amount")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Pay Invoice" }).click();
    await expect(page.getByText(/^Paid [\d,.]+ sats!$/)).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press("Escape");
  },

  /** Balance → Send → eCash Token → Generate Token, until it is shown; returns it. */
  async makeToken(page: Page, sats: number): Promise<string> {
    await openBalance(page, "Send");
    await popover(page).getByPlaceholder("0").fill(String(sats));
    await page.getByRole("button", { name: "Generate Token" }).click();
    const token = await popover(page)
      .locator(".font-mono.break-all")
      .first()
      .textContent({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    return token ?? "";
  },

  async send(page: Page, text: string) {
    await dismissTopUp(page);
    await composer(page).fill(text);
    await page.getByRole("button", { name: "Send message" }).click();
  },

  replyText: async (page: Page) =>
    (await replies(page).allTextContents()).at(-1) ?? "",

  async waitReplyText(page: Page, text: string) {
    await expect(lastReply(page)).toContainText(text, { timeout: 60_000 });
  },

  async waitIdle(page: Page) {
    await expect(
      page.getByRole("button", { name: "Send message" })
    ).toBeVisible({ timeout: 60_000 });
  },

  async stop(page: Page) {
    await page.getByRole("button", { name: "Stop generation" }).click();
  },

  async retryLast(page: Page) {
    await page.getByRole("button", { name: "Retry response" }).last().click();
  },

  async lastVersion(page: Page) {
    const nav = page.getByLabel("Message version navigation").last();
    if (!(await nav.count())) return null;
    const [, at, of] = ((await nav.textContent()) ?? "").match(
      /(\d+)\s*\/\s*(\d+)/
    )!;
    return { at: Number(at), of: Number(of) };
  },

  async waitThought(page: Page) {
    await expect(
      page.getByText(/^(Thought for [\d.]+s|Thinking)$/).last()
    ).toBeVisible({ timeout: 60_000 });
  },

  /** Header → "N sats provider credit" → Refund All, until the credit is back in the wallet. */
  async returnCredit(page: Page) {
    const credit = page.getByRole("button", {
      name: /^\d+ sats provider credit$/,
    });
    if (!(await credit.isVisible())) return;
    await credit.click();
    await page.getByRole("button", { name: "Refund All" }).click();
    await expect(credit).toBeHidden({ timeout: 60_000 });
  },

  async waitError(page: Page) {
    const shown = page
      .getByText(/^(Uncaught Error|ATTENTION|Unknown Error)/)
      .last();
    const folded = page
      .getByRole("button", { name: /^Show \d+ Errors?$/ })
      .last();
    await expect(shown.or(folded)).toBeVisible({ timeout: 60_000 });
  },

  /** ?cashu= is taken by the top-up prompt, which opens by itself at a zero balance. */
  async fundByLink(page: Page, appUrl: string, token: string) {
    await page.goto(`${appUrl}/?cashu=${encodeURIComponent(token)}`);
    await expect(page.getByText(/^Received [\d,]+ sats!$/)).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => main.balance(page).catch(() => 0), { timeout: 30_000 })
      .toBeGreaterThan(0);
  },

  async waitChats(page: Page, n: number) {
    await dismissTopUp(page);
    const expand = page.getByRole("button", { name: "Expand sidebar" });
    if (await expand.isVisible()) await expand.click();
    const items = page.locator("div.p-2.rounded.text-sm.cursor-pointer.group");
    await expect
      .poll(() => items.count(), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(n);
  },

  /** Settings → General → Switch Account → Use, there and back, until each balance shows. */
  async switchAccount(page: Page) {
    const mine = await main.balance(page);
    const other = async () => {
      await openSettings(page);
      await page
        .getByRole("button", { name: "Use", exact: true })
        .first()
        .click();
    };
    await other();
    await expect
      .poll(() => main.balance(page).catch(() => -1), { timeout: 30_000 })
      .toBe(0);
    await page.keyboard.press("Escape");
    await other();
    await expect
      .poll(() => main.balance(page).catch(() => -1), { timeout: 30_000 })
      .toBe(mine);
    await page.keyboard.press("Escape");
  },
};
