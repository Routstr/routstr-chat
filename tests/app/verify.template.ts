// The verify skill's starting point (.claude/skills/verify): copied to zz-verify.spec.ts, the
// steps filled in for one change, and deleted when done.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { v2 } from "./drivers/v2";
import { seedKitProvider } from "./seed";

// what the kit causes, not the app: the seal blocks outside hosts (the app's default mints
// among them), and with service workers blocked workbox-window reads a missing registration
const KIT_NOISE = [
  /ERR_BLOCKED_BY_CLIENT/,
  /update mint https:/,
  /reading 'waiting'/,
];

/** The page as it is now, at phone and at desktop width, saved for a person to look at. */
async function shots(page: Page, name: string) {
  const sizes = {
    phone: { width: 390, height: 844 },
    desktop: { width: 1280, height: 800 },
  };
  for (const [size, viewport] of Object.entries(sizes)) {
    await page.setViewportSize(viewport);
    // the layout follows the width through a media query listener: two frames let React draw it
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r))
        )
    );
    await page.screenshot({
      path: `test-results/verify/${name}-${size}.png`,
      animations: "disabled",
    });
  }
}

// a run shows only its own pictures
test.beforeAll(() =>
  fs.rmSync("test-results/verify", { recursive: true, force: true })
);

test("CHANGE: what a person does, and what they must see", async ({
  page,
  kit,
  appUrl,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await kit.upstream.reset();
  await v2.open(page, appUrl);
  await seedKitProvider(page, kit.coreUrl, "kit-cheap");
  await v2.fund(page, appUrl, await kit.mintToken(300));

  // the steps to the change, and what must show after them
  await v2.send(page, "[kit:usage=10,10] hello kit");
  await v2.waitReplyText(page, "Echo: hello kit");
  await shots(page, "reply");

  expect(errors.filter((e) => !KIT_NOISE.some((n) => n.test(e)))).toEqual([]);
});
