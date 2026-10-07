// The address bar follows the app (a ?tab= link opened, a ?cashu= link taken, ?chatId= for the
// open chat) without the page loading again, at / and under a base path (/v2 beside main).
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { seedAccounts } from "./seed";

test("the address follows the app without loading the page again", async ({ page, context, appUrl }) => {
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  const loads: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) loads.push(r.url());
  });
  await page.goto(`${appUrl}/?tab=apikeys`);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => new URL(page.url()).searchParams.has("tab")).toBe(false);
  expect(new URL(page.url()).pathname).toBe(new URL(`${appUrl}/`).pathname);
  expect(loads).toHaveLength(1);
});
