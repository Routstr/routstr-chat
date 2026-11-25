// The rail's card hands focus back when it turns from the wallet to the chats, but only while
// focus is still on it: a model picker opened during the turn keeps focus and stays open.
import { finalizeEvent, generateSecretKey, nip19 } from "nostr-tools";
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts, seedKitProvider } from "./seed";
import list from "../../components/v2/picker/openrouter.json";
import { PROVIDER_ALIAS } from "../kit/net";

test("the model picker opened as the wallet turns back stays open", async ({ page, context, appUrl }) => {
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  await v2.open(page, appUrl);
  await page.getByRole("button", { name: /^Open wallet\./ }).first().click();
  await page.getByRole("button", { name: "Back to chats" }).click();
  // at once, while the card still turns
  await page.getByRole("main").getByRole("button", { name: /^(Model: .*|Choose a model)$/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await expect(picker).toBeVisible();
  // longer than the turn, then it is still there
  await page.waitForTimeout(1500);
  await expect(picker).toBeVisible();
});

test("another model for an answer: the picker opens for it and the model chosen answers it again", async ({
  page,
  kit,
  appUrl,
}) => {
  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(300));
  await v2.send(page, "[kit:usage=10,10] hello kit");
  await v2.waitReplyText(page, "Echo: hello kit");
  await v2.waitIdle(page);

  await page.locator("article.rd-ai").last().getByRole("button", { name: "Try again with another model" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await expect(picker.getByPlaceholder("Try the answer again with…")).toBeVisible();
  await picker.getByRole("option", { name: /Kit Echo/ }).click();

  // the same question goes again, to the model chosen, as a second version of the answer
  await expect.poll(async () => (await kit.upstream.requests()).map((r) => r.model)).toEqual(["kit-cheap", "kit-echo"]);
  await v2.waitIdle(page);
  await expect.poll(() => v2.lastVersion(page)).toEqual({ at: 2, of: 2 });
  await expect(page.locator("article.rd-ai").last().locator(".rd-model")).toHaveText("kit echo");

  // opened from the composer, the picker only changes the model
  await page.getByRole("main").getByRole("button", { name: /^Model: / }).click();
  await expect(picker.getByPlaceholder("Search models or makers")).toBeVisible();
  await picker.getByRole("option", { name: /Kit Cheap/ }).click();
  await expect(picker).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect((await kit.upstream.requests()).length).toBe(2);
});

test("Deals: a model a node sells far below its list price is listed there with how clever it is, best deal first, without touching the other lists' sort", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  // the node lists Kit Echo under a scored model's id from the shipped list, at a tenth of its
  // price (only the listing is changed: nothing is sent to it)
  const all = Object.entries(list.prices);
  const smart: Record<string, number> = list.intelligence;
  const bare = (x: string) => x.slice(x.indexOf("/") + 1);
  const [id, [lp, lc]] = all.find(([x]) => smart[x] && all.filter(([y]) => bare(y) === bare(x)).length === 1)!;
  const iq = `intelligence ${Math.round(smart[id])}`;
  await context.route(/\/v1\/models(\?|$)/, async (route) => {
    const url = route.request().url();
    const res = await route.fetch({ url: url.startsWith(PROVIDER_ALIAS) ? kit.coreUrl + url.slice(PROVIDER_ALIAS.length) : url });
    const body = (await res.json()) as { data: { id: string; pricing: Record<string, number> }[] };
    for (const m of body.data)
      if (m.id === "kit-echo") Object.assign(m, { id, pricing: { ...m.pricing, prompt: lp / 10, completion: lc / 10 } });
    await route.fulfill({ response: res, json: body });
  });
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");

  await page.getByRole("main").getByRole("button", { name: /^(Model: .*|Choose a model)$/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  const sort = picker.locator(".mp-sort");
  const usual = await sort.textContent();
  await picker.getByRole("button", { name: "Deals, 1" }).click();
  await expect(picker.getByText("Deals", { exact: true }).first()).toBeVisible();
  const deal = picker.getByRole("option", { name: /Kit Echo/ });
  await expect(deal).toContainText("90% below list");
  await expect(deal).toContainText(iq);
  await expect(picker.getByRole("option")).toHaveCount(1);
  await expect(picker.locator(".mp-scope")).toHaveText("1 deal");
  await expect(sort).toHaveText("Best deal first");
  await deal.hover(); // the details show the row in reach (a click would use it)
  await expect(picker.locator(".dt-deal")).toHaveText("90% less than OpenRouter’s list price");
  await expect(picker.locator(".dt-smart")).toHaveText(`${Math.round(smart[id])} on Artificial Analysis’s index`);

  // every other list keeps the sort it had, and shows the deal on its row too
  await picker.getByRole("button", { name: /^All models, / }).click();
  await expect(sort).toHaveText(usual!);
  await expect(picker.getByRole("option", { name: /Kit Echo/ })).toContainText("90% below list");
  await expect(picker.getByRole("option", { name: /Kit Echo/ })).not.toContainText(iq);
  await expect(picker.getByRole("option", { name: /Kit Cheap/ })).not.toContainText("below list");
});

// the node also lists `n` OpenAI models, each a day older than the last (listed only: nothing is sent to them)
async function listMore(context: BrowserContext, coreUrl: string, n: number) {
  await context.route(/\/v1\/models(\?|$)/, async (route) => {
    const url = route.request().url();
    const res = await route.fetch({ url: url.startsWith(PROVIDER_ALIAS) ? coreUrl + url.slice(PROVIDER_ALIAS.length) : url });
    const body = (await res.json()) as { data: { id: string; name: string; created: number }[] };
    const like = body.data.find((m) => m.id === "kit-cheap")!;
    for (let i = 1; i <= n; i++) body.data.push({ ...like, id: `openai/kit-many-${i}`, name: `Kit Many ${i}`, created: like.created - i * 86400 });
    await route.fulfill({ response: res, json: body });
  });
}

test("the picker opens again on the tab you picked, at the model in use, and has Favorites once a model is starred", async ({
  page,
  context,
  kit,
  appUrl,
}) => {
  await listMore(context, kit.coreUrl, 20);
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(300));

  const chip = page.getByRole("main").getByRole("button", { name: /^(Model: .*|Choose a model)$/ });
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await chip.click();
  const openai = picker.getByRole("button", { name: /^OpenAI, / });
  await openai.click();
  await picker.getByRole("option", { name: /Kit Many 7\b/ }).click();
  // gone, not only out of sight
  await expect(page.locator(".mp")).toHaveCount(0);

  await chip.click();
  await expect(openai).toHaveAttribute("aria-pressed", "true");
  const row = picker.getByRole("option", { name: /Kit Many 7\b/ });
  await expect(row).toHaveAttribute("data-current", "");
  await expect(row).toHaveAttribute("data-active", "");
  // nothing starred yet: no Favorites tab, until a star
  await expect(picker.getByRole("button", { name: /^Favorites, / })).toHaveCount(0);
  await row.locator(".r-star").click();
  await expect(picker.getByRole("button", { name: "Favorites, 1" })).toBeVisible();
});

test("a list that changes while you look at it stays where you scrolled it", async ({ page, context, kit, appUrl }) => {
  await listMore(context, kit.coreUrl, 150);
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");

  await page.getByRole("main").getByRole("button", { name: /^(Model: .*|Choose a model)$/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  await expect(picker.getByRole("option", { name: /Kit Many 1\b/ })).toBeVisible();
  const list = picker.locator(".mp-list");
  await list.evaluate((l) => (l.scrollTop = 2000));
  await page.waitForTimeout(300);

  // another tab turns a provider off: the model list here is asked for again, and comes back the same
  const other = await context.newPage();
  await v2.open(other, appUrl);
  await other.evaluate(() => localStorage.setItem("providers_off", JSON.stringify(["https://nobody.example/"])));
  await page.waitForTimeout(2000);
  expect(await list.evaluate((l) => l.scrollTop)).toBe(2000);
});

// hundreds of models: the list draws the rows near the screen and the rest as it is scrolled, never all
// of them at once (tens of thousands of elements, enough to bring a phone down)
test("a long list draws the rows near the screen, and the rest as you scroll to them", async ({ page, context, kit, appUrl }) => {
  await listMore(context, kit.coreUrl, 700);
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");

  await page.getByRole("main").getByRole("button", { name: /^(Model: .*|Choose a model)$/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  const rows = picker.getByRole("option");
  await expect(rows.first()).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await rows.count()).toBeLessThan(200);

  const list = picker.locator(".mp-list");
  await expect(async () => {
    await list.evaluate((l) => (l.scrollTop = l.scrollHeight));
    await expect(rows).toHaveCount(703, { timeout: 100 });
  }).toPass();
});

// no provider answers (every one is down, or the connection is): the picker says so, not that they
// were turned off, and Try again asks them again
test("an empty list no provider answered says so, and Try again asks again", async ({ page, context, kit, appUrl }) => {
  let down = true;
  await context.route(/\/v1\/models(\?|$)/, async (route) => {
    if (down) return route.fulfill({ status: 503, body: "busy" });
    const url = route.request().url();
    await route.fulfill({ response: await route.fetch({ url: url.startsWith(PROVIDER_ALIAS) ? kit.coreUrl + url.slice(PROVIDER_ALIAS.length) : url }) });
  });
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  const chip = page.getByRole("main").getByRole("button", { name: /^(Model: .*|Choose a model)$/ });
  await expect(chip).toHaveAccessibleName("Choose a model");
  await chip.click();
  const empty = page.locator(".mp-empty");
  await expect(empty).toContainText("No provider answered");
  down = false;
  await empty.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("option", { name: /Kit Cheap/ })).toBeVisible();
});

test("with no model list saved yet, a chosen model a slower provider serves is waited for, never asked for again", async ({ page, context, kit, appUrl }) => {
  // a second provider, announced and turned on by hand, that lists only Mistral Kit Slow and answers last
  const slow = "https://slow.example/";
  const key = generateSecretKey();
  const announce = finalizeEvent({ kind: 38421, created_at: Math.floor(Date.now() / 1000), tags: [["d", slow], ["u", slow]], content: "" }, key);
  await kit.relay.seed([announce]);
  let answer!: () => void;
  const late = new Promise<void>((resolve) => (answer = resolve));
  await context.route(/^https:\/\/slow\.example\//, async (route) => {
    if (!route.request().url().endsWith("/v1/models")) return route.fulfill({ status: 404 });
    await late;
    const res = await route.fetch({ url: `${kit.coreUrl}v1/models` });
    const body = (await res.json()) as { data: { id: string; name: string }[] };
    body.data = [{ ...body.data.find((m) => m.id === "kit-cheap")!, id: "kit-slow", name: "Mistral Kit Slow" }];
    await route.fulfill({ response: res, json: body });
  });
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  await context.addInitScript((slow) => {
    if (localStorage.getItem("lastUsedModel")) return; // only on the first load
    localStorage.setItem("lastUsedModel", JSON.stringify("kit-slow"));
    const open = indexedDB.open("routstr-chat-discovery", 3);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("sdk_storage").put(JSON.stringify([slow]), "manually_enabled_providers");
      // the rest of the schema the SDK makes for this database
      const usage = open.result.createObjectStore("usage_tracking", { keyPath: "id" });
      for (const i of ["timestamp", "modelId", "baseUrl", "sessionId", "client", "provider"]) usage.createIndex(i, i, { unique: false });
    };
    open.onsuccess = () => open.result.close();
  }, slow);

  try {
    const kitList = page.waitForResponse((r) => r.url().endsWith("/v1/models") && !r.url().startsWith(slow));
    await v2.open(page, appUrl);
    await kitList;
    const chip = page.getByRole("main").locator("button.model");
    await expect(chip).toHaveAccessibleName("Finding models");
    await page.getByRole("textbox", { name: "Message" }).fill("hi");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog", { name: "Choose a model" })).toHaveCount(0);

    answer();
    await expect(chip).toHaveAccessibleName(/^Model: .*Kit Slow\. Change model$/);
  } finally {
    // the relay outlives this test: the provider goes with it
    await kit.relay.seed([finalizeEvent({ kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [["e", announce.id]], content: "" }, key)]);
  }
});

// a search looks through every model, so while it lasts no tab is pressed; pressing one shows that tab
test("while you search no tab is pressed, and pressing one ends the search on that tab", async ({ page, context, kit, appUrl }) => {
  await listMore(context, kit.coreUrl, 3);
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await page.getByRole("main").getByRole("button", { name: /^(Model: .*|Choose a model)$/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  const openai = picker.getByRole("button", { name: /^OpenAI, / });
  await openai.click();
  const search = picker.getByPlaceholder("Search models or makers");
  await search.fill("kit cheap");
  await expect(picker.getByRole("option", { name: /Kit Cheap/ })).toBeVisible();
  await expect(openai).toHaveAttribute("aria-pressed", "false");
  // the keys still reach the tabs: Tab lands on the one picked last
  await expect(openai).toHaveAttribute("tabindex", "0");

  await openai.click();
  await expect(search).toHaveValue("");
  await expect(openai).toHaveAttribute("aria-pressed", "true");
  await expect(picker.getByRole("option")).toHaveCount(3);
});

// a model picked with the message already written, then Enter as soon as the message has the keys
// again: it goes to the model picked, never the one before it (the choice lands as the card leaves)
test("Enter right after picking a model sends to the model picked", async ({ page, kit, appUrl }) => {
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(300));
  const chip = page.getByRole("main").getByRole("button", { name: /^Model: / });
  await expect(chip).toHaveAccessibleName(/^Model: Kit Cheap\./);
  await page.getByRole("textbox", { name: "Message" }).fill("[kit:usage=10,10] to the one picked");
  await chip.click();
  await page.getByRole("dialog", { name: "Choose a model" }).getByRole("option", { name: /Kit Echo/ }).click();
  await page.waitForFunction(() => document.activeElement?.matches(".island textarea"), null, { polling: "raf" });
  await page.keyboard.press("Enter");
  await v2.waitReplyText(page, "Echo: to the one picked");
  expect((await kit.upstream.requests()).at(-1)?.model).toBe("kit-echo");
});

// sats at a mint the provider does not take cannot pay it: Add funds says how many more a message
// needs, never "0 more" because the wallet holds plenty elsewhere
test("a model your sats cannot pay says how many more it needs, though the wallet holds plenty", async ({ page, context, kit, appUrl }) => {
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.receive(page, await kit.mintToken(100, { otherMint: true }));
  await page.keyboard.press("Escape");

  await page.getByRole("main").getByRole("button", { name: /^(Model: .*|Choose a model)$/ }).click();
  const picker = page.getByRole("dialog", { name: "Choose a model" });
  const add = picker.getByRole("button", { name: /^Add funds/ });
  await expect(add).toBeVisible();
  await expect(add).toContainText(/needs [1-9][\d,]* more/);
});
