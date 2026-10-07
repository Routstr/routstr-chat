// The rail's card hands focus back when it turns from the wallet to the chats, but only while
// focus is still on it: a model picker opened during the turn keeps focus and stays open.
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts } from "./seed";

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
