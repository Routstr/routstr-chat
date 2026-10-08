// A picture taken into the composer is kept on this device at once, through the account's file
// store, and a copy is asked of Blossom (sealed off here, so the chip says the copy failed).
import type { Page } from "@playwright/test";
import { generateSecretKey, nip19 } from "nostr-tools";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedAccounts, seedKitProvider } from "./seed";

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

// a one-page PDF that says "hello pdf"
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 20 100 Td (hello pdf) Tj ET\nendstream endobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n"
);

// a PDF still being read would go without its text: Send waits until it is read
test("does not send while a PDF is still being read", async ({ page, kit, appUrl }) => {
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(100));
  // reading takes a while: the PDF reader's code is slow to come
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/_next/static/**/*.js", async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    if (body.includes("GlobalWorkerOptions")) await held;
    await route.fulfill({ response: res, body });
  });

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.locator(".island .file")).toContainText("Reading…");
  await page.getByRole("textbox", { name: "Message" }).fill("[kit:usage=10,10] read it");
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  await page.waitForTimeout(1_500);
  await expect(page.locator("article.rd-me")).toHaveCount(0);

  release();
  await expect(page.locator(".island .file")).not.toContainText("Reading…", { timeout: 30_000 });
  await page.getByRole("textbox", { name: "Message" }).press("Enter");
  await expect(page.locator("article.rd-me")).toHaveCount(1, { timeout: 30_000 });
});
