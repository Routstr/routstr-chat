// In-app tests: the built app (or KIT_APP_URL), driven headless, sealed to the kit stack.
// Run them through the kit (pnpm test app), which starts the stack and passes KIT_* env.
import { defineConfig } from "@playwright/test";
import { chromiumPath } from "../kit/net";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  workers: 1, // one browser at a time
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "../../test-results/app",
  use: {
    actionTimeout: 15_000, // a missing button fails in 15 s, not at the 90 s test timeout
    headless: true,
    serviceWorkers: "block",
    launchOptions: { executablePath: chromiumPath() },
    trace: "retain-on-failure",
  },
});
