// The live run: the real app on this machine, real relays, real mints, real providers, and the
// test account's real sats. Not part of the kit: run it by hand (see live.spec.ts).
import { defineConfig } from "@playwright/test";
import { chromiumPath } from "../kit/net";

export default defineConfig({
  testDir: ".",
  testMatch: "live.spec.ts",
  workers: 1,
  timeout: 10 * 60_000, // a Lightning top-up waits for a person to pay it
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: "../../test-results/live",
  use: {
    headless: true,
    serviceWorkers: "block",
    launchOptions: { executablePath: chromiumPath() },
    actionTimeout: 30_000,
    // the secret key is typed into the app: no trace, screenshot or video may keep it
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
