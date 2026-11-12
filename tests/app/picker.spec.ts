// The rail's card hands focus back when it turns from the wallet to the chats, but only while
// focus is still on it: a model picker opened during the turn keeps focus and stays open.
import { generateSecretKey, nip19 } from "nostr-tools";
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
