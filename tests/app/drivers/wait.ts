// Waits that end within about 50 ms of the page getting there. Playwright's own expect checks
// at 0, 20, 70, 170 and 270 ms and then only every 500 ms, so a step timed around it would be
// rounded up to that tick; perf times the drivers' steps, so their waits use these.
import type { Locator, Page } from "@playwright/test";

/** Until `check` is true, checking every 50 ms. */
export async function until(
  check: () => Promise<boolean>,
  what: string,
  timeout = 30_000
): Promise<void> {
  const end = Date.now() + timeout;
  let last: unknown; // a check that throws (two matches, a closed page) says why in the end
  while (
    !(await check().catch((e) => {
      last = e;
      return false;
    }))
  ) {
    if (Date.now() > end)
      throw new Error(
        `waited ${timeout} ms for ${what}${last ? `; last error: ${String(last).split("\n")[0]}` : ""}`
      );
    await new Promise((r) => setTimeout(r, 50));
  }
}

export const shown = (l: Locator, timeout?: number) =>
  until(() => l.isVisible(), `${l} to show`, timeout);

export const gone = (l: Locator, timeout?: number) =>
  until(async () => !(await l.isVisible()), `${l} to go`, timeout);

/**
 * Until the last element matching `css` contains `text`, checked in the page every frame;
 * returns the page time (performance.now()) it first did.
 */
export async function textShown(
  page: Page,
  css: string,
  text: string
): Promise<number> {
  const at = await page.waitForFunction(
    ([css, text]) => {
      const all = document.querySelectorAll(css);
      const last = all[all.length - 1];
      return last?.textContent?.includes(text) ? performance.now() : false;
    },
    [css, text] as const,
    { timeout: 60_000 }
  );
  return (await at.jsonValue()) as number;
}
