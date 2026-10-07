// A search hit opens its chat at the question it was found in, with a long answer above it
// whose blocks off the screen were never laid out.
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedKitProvider } from "./seed";

test("a search hit opens its chat at the question it was found in", async ({ page, kit, appUrl }) => {
  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(300));
  for (const ask of ["a long one", "haystackneedle, and another long one"]) {
    await v2.send(page, `[kit:md=3000] [kit:usage=10,10] ${ask}`);
    await v2.waitReplyText(page, "endlong");
    await v2.waitIdle(page);
  }

  await page.keyboard.press("Control+Shift+O");
  await page.keyboard.press("Control+K");
  await page.getByRole("combobox", { name: "Search chats and actions" }).fill("haystackneedle");
  await page.keyboard.press("Enter");
  const hit = page.locator(".rd-me", { hasText: "haystackneedle" });
  await expect(hit).toBeInViewport();
  // and it stays there once the blocks around it are drawn
  await page.waitForTimeout(1000);
  await expect(hit).toBeInViewport();
});
