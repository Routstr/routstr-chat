// The rail's card hands focus back when it turns from the wallet to the chats, but only while
// focus is still on it: a model picker opened during the turn keeps focus and stays open.
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts, seedKitProvider } from "./seed";

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
