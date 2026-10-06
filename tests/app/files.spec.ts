// A picture taken into the composer is kept on this device at once, through the account's file
// store, and a copy is asked of Blossom (sealed off here, so the chip says the copy failed).
import type { Page } from "@playwright/test";
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts } from "./seed";

// one transparent pixel
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

/** Files in main's database on this device (never creating it: an empty one
 *  would have no store for the app to write to). */
const filesKept = (page: Page) =>
  page.evaluate(async () =>
    !(await indexedDB.databases()).some((d) => d.name === "routstr-files")
      ? 0
      : new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("routstr-files");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("files")) return resolve(0);
            const count = db.transaction("files").objectStore("files").count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
        })
  );

test("keeps an attached picture on this device at once, and asks Blossom for a copy", async ({
  page,
  context,
  appUrl,
}) => {
  await seedAccounts(context, [nip19.nsecEncode(generateSecretKey())]);
  await v2.open(page, appUrl);
  expect(await filesKept(page)).toBe(0);

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG });

  const chip = page.locator(".island .file");
  await expect(chip.locator("img.thumb")).toBeVisible();
  await expect.poll(() => filesKept(page)).toBe(1);
  await expect(chip).toHaveAttribute("data-sync", "failed", {
    timeout: 40_000,
  });
});
