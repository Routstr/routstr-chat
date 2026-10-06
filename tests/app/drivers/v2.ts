// How a person uses v2 (components/v2), by the names a screen reader would read. Every
// step returns once the person would see its result.
import { expect, type Page } from "@playwright/test";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
// the composer's own Send / Stop (the wallet has a Send too)
const composerButton = (page: Page, name: "Send" | "Stop") =>
  page.getByRole("main").getByRole("button", { name, exact: true });
// the rail's balance button: "Open wallet. Balance 1,234 sats." (also when the rail is folded)
const railWallet = (page: Page) =>
  page.getByRole("button", { name: /^Open wallet\./ }).first();
const replies = (page: Page) => page.locator(".rd-msg.rd-ai");
const lastReply = (page: Page) => replies(page).last();
// the wallet's panes are regions named after the place: Wallet, Add funds, Send
const view = (page: Page, v: "home" | "add" | "send") =>
  page.getByRole("region", {
    name: { home: "Wallet", add: "Add funds", send: "Send" }[v],
    exact: true,
  });

// The rail's card flips to show the wallet on its back, over the balance button and the
// gear, so every wallet step ends by flipping it back. The face not shown is inert.
const walletShown = async (page: Page) =>
  (await page.locator(".face.back").getAttribute("inert")) === null;

async function openWallet(page: Page) {
  if (!(await walletShown(page))) await railWallet(page).click();
  await expect(
    view(page, "home").getByRole("button", { name: "Add", exact: true })
  ).toBeVisible();
}

async function backToChats(page: Page) {
  const back = page.getByRole("button", {
    name: /^Back to (chats|wallet|send)$/,
  });
  for (let i = 0; i < 4 && (await walletShown(page)); i++)
    await back.first().click();
  await expect.poll(() => walletShown(page)).toBe(false);
}

/** Wallet → Send, past a payment or token Send still shows from last time (it keeps them). */
async function openSend(page: Page) {
  await openWallet(page);
  await view(page, "home")
    .getByRole("button", { name: "Send", exact: true })
    .click();
  const send = view(page, "send");
  await expect(send).toHaveAttribute("data-pos", "here");
  const finished = send.getByRole("button", {
    name: /^(Pay another invoice|Done)$/,
  });
  if (await finished.isVisible()) await finished.click();
  return send;
}

async function openSettings(page: Page, section: string) {
  if (!(await page.getByRole("dialog", { name: "Settings" }).isVisible())) {
    // signed in, the light at the rail's foot opens the account menu first
    const accounts = page.getByRole("button", {
      name: /Accounts and settings$/,
    });
    if (await accounts.count()) {
      await accounts.first().click();
      await page
        .getByRole("menu", { name: "Accounts" })
        .getByRole("menuitem", { name: "Settings" })
        .click();
    } else
      await page
        .getByRole("button", { name: "Settings", exact: true })
        .first()
        .click();
  }
  await page.locator(`#nav-${section}`).click();
}

export const v2 = {
  name: "v2",

  /** Until the boot mark has gone and the composer takes a message. */
  async open(page: Page, appUrl: string, path = "/") {
    await page.goto(`${appUrl}${path}`);
    await v2.ready(page);
  },

  async loaded(page: Page) {
    await expect(page.locator(".pf-bootlayer")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(composer(page)).toBeVisible({ timeout: 30_000 });
  },

  ready: (page: Page) => v2.loaded(page),

  /** Redeems a token through ?cashu= (makes a key on this device if there is none). */
  async fund(page: Page, appUrl: string, token: string) {
    const before = await v2.balance(page).catch(() => 0);
    await page.goto(`${appUrl}/?cashu=${encodeURIComponent(token)}`);
    await expect
      .poll(() => v2.balance(page).catch(() => before), { timeout: 30_000 })
      .toBeGreaterThan(before);
  },

  /** The wallet total the rail shows (its aria-label holds the true total at once). */
  async balance(page: Page): Promise<number> {
    const label =
      (await railWallet(page).getAttribute("aria-label", { timeout: 2000 })) ??
      "";
    const n = label.match(/Balance ([\d,.]+) sats/);
    if (!n) throw new Error(`no balance yet: ${label}`);
    return Number(n[1].replace(/,/g, ""));
  },

  /** Settings → Account → Sign in → Secret key (only offered while no key is on the device). */
  async signIn(page: Page, nsec: string) {
    await openSettings(page, "account");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const way = page.locator('.pa-way[data-way="key"]'); // the "Secret key" way, with its own Sign in
    await page.getByRole("button", { name: /^Secret key/ }).click();
    await page.getByLabel("Secret key").fill(nsec);
    await way.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "You are in" })).toBeVisible(
      { timeout: 30_000 }
    );
  },

  /** Wallet → Add → Cashu token, until it says received. */
  async receive(page: Page, token: string) {
    await openWallet(page);
    await view(page, "home")
      .getByRole("button", { name: "Add", exact: true })
      .click();
    const add = view(page, "add");
    await add.getByRole("tab", { name: "Cashu token" }).click();
    await add.getByRole("textbox", { name: "Cashu token" }).fill(token);
    // a token the app cannot read leaves Receive disabled: fail here, not at the test timeout
    await add
      .getByRole("button", { name: /^Receive [\d,]+ sats$/ })
      .click({ timeout: 15_000 });
    await expect(add.getByText("Added to your wallet")).toBeVisible({
      timeout: 30_000,
    });
    await backToChats(page);
  },

  /** Wallet → the Mint menu at the foot → that mint. */
  async useMint(page: Page, mintUrl: string) {
    const host = new URL(mintUrl).host;
    await openWallet(page);
    // the foot shows the mint's name, and kit mints share one, so pick by host in the menu
    const foot = page.getByRole("button", { name: /^Mint / });
    const item = page
      .getByRole("menu", { name: "Mints" })
      .getByRole("menuitemradio", {
        name: new RegExp(host.replace(/[.]/g, "\\.")),
      });
    await foot.click();
    if ((await item.getAttribute("aria-checked")) !== "true") {
      await item.click();
      await expect(item).toBeHidden();
      await foot.click();
    }
    await expect(item).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(item).toBeHidden();
    await backToChats(page);
  },

  /** Wallet → Send → Lightning → Pay, until it says paid. */
  async payInvoice(page: Page, bolt11: string) {
    const send = await openSend(page);
    await send.getByRole("tab", { name: "Lightning" }).click();
    const invoice = send.getByRole("textbox", { name: "Lightning invoice" });
    await invoice.fill(bolt11);
    await invoice.press("Enter"); // typed text is a draft until Enter
    await send.getByRole("button", { name: /^Pay [\d,]+ sats$/ }).click();
    await expect(
      send.getByRole("button", { name: "Pay another invoice" })
    ).toBeVisible({ timeout: 30_000 });
    await backToChats(page);
  },

  /** Wallet → Send → Cashu token → Create token, until it is shown; returns it. */
  async makeToken(page: Page, sats: number): Promise<string> {
    const send = await openSend(page);
    await send.getByRole("tab", { name: "Cashu token" }).click();
    await send.getByLabel("Amount in sats").fill(String(sats));
    await send.getByRole("button", { name: "Create token" }).click();
    const token = await send
      .locator(".wl-lnstr code")
      .first()
      .textContent({ timeout: 30_000 });
    await backToChats(page);
    return token ?? "";
  },

  async send(page: Page, text: string) {
    await composer(page).fill(text);
    await composerButton(page, "Send").click();
  },

  replyText: async (page: Page) =>
    (await replies(page).allTextContents()).at(-1) ?? "",

  async waitReplyText(page: Page, text: string) {
    await expect(lastReply(page)).toContainText(text, { timeout: 60_000 });
  },

  async waitIdle(page: Page) {
    await expect(composerButton(page, "Send")).toBeVisible({
      timeout: 60_000,
    });
  },

  async stop(page: Page) {
    await composerButton(page, "Stop").click();
  },

  async retryLast(page: Page) {
    await page
      .locator("article.rd-ai")
      .last()
      .getByRole("button", { name: "Try again" })
      .click();
  },

  async lastVersion(page: Page) {
    const group = page
      .locator("article.rd-ai")
      .last()
      .getByRole("group", { name: /^Version \d+ of \d+$/ });
    if (!(await group.count())) return null;
    const [, at, of] = ((await group.getAttribute("aria-label")) ?? "").match(
      /(\d+) of (\d+)/
    )!;
    return { at: Number(at), of: Number(of) };
  },

  async waitThought(page: Page) {
    await expect(page.getByText("Thought it through").last()).toBeVisible({
      timeout: 60_000,
    });
  },

  /** Wallet → "Return N sats to the wallet", until nothing is held at a provider. */
  async returnCredit(page: Page) {
    await openWallet(page);
    const give = page.getByRole("button", {
      name: /^Return [\d,]+ sats to the wallet$/,
    });
    if (await give.isVisible()) {
      await give.click();
      await expect(give).toBeHidden({ timeout: 60_000 });
    }
    await backToChats(page);
  },

  async waitError(page: Page) {
    await expect(page.locator('.rd-sys[role="alert"]').last()).toBeVisible({
      timeout: 60_000,
    });
  },

  fundByLink: (page: Page, appUrl: string, token: string) =>
    v2.fund(page, appUrl, token),

  async waitChats(page: Page, n: number) {
    const list = page.getByRole("navigation", { name: "Chats" });
    await expect
      .poll(() => list.locator(".sb-go").count(), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(n);
  },

  /** Settings → Account → Other keys → Switch, there and back, until each balance shows. */
  async switchAccount(page: Page) {
    const mine = await v2.balance(page);
    const other = async () => {
      await openSettings(page, "account");
      await page
        .locator("#g-others")
        .getByRole("button", { name: "Switch" })
        .first()
        .click();
    };
    await other();
    await expect
      .poll(() => v2.balance(page).catch(() => -1), { timeout: 30_000 })
      .toBe(0);
    await other();
    await expect
      .poll(() => v2.balance(page).catch(() => -1), { timeout: 30_000 })
      .toBe(mine);
  },
};
