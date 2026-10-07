// Main at / and v2 at /v2 on one address, as they will be served: run through the kit with
// KIT_PW_CONFIG=tests/shared/playwright.config.ts and KIT_APP_OUT=<a folder with main's build,
// and v2's build (made with NEXT_PUBLIC_BASE_PATH=/v2) as its v2/ folder>.
import { defineConfig } from "@playwright/test";
import base from "../app/playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  outputDir: "../../test-results/shared",
  // here the service workers are what is checked
  use: { ...base.use, serviceWorkers: "allow" },
});
