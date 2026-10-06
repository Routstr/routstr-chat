// Parity: the same checks on main and on v2. Run through the kit (pnpm kit parity), which
// serves both builds and passes KIT_MAIN_URL and KIT_APP_URL.
import { defineConfig } from "@playwright/test";
import base from "../app/playwright.config";
import type { ParityOptions } from "./fixtures";

export default defineConfig<ParityOptions>({
  ...base,
  testDir: ".",
  // each app runs on its own, and a run clears its output folder first
  projects: [
    {
      name: "main",
      outputDir: "../../test-results/parity/main",
      use: { driverName: "main", appUrl: process.env.KIT_MAIN_URL },
    },
    {
      name: "v2",
      outputDir: "../../test-results/parity/v2",
      use: { driverName: "v2", appUrl: process.env.KIT_APP_URL },
    },
  ],
});
