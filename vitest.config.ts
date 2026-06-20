import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/postcss.config.mjs"],
    environment: "node",
    // React-hook tests need a DOM + working localStorage/sessionStorage; run any
    // *.test.tsx under jsdom while keeping the fast node env for the rest.
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    // jsdom must have a concrete (non-opaque) origin or window.localStorage is
    // unavailable; give it one so the storage-backed recovery logic can run.
    environmentOptions: {
      jsdom: {
        url: "https://chat.test.local/",
      },
    },
    include: [
      "sdk/__tests__/**/*.test.ts",
      "features/**/__tests__/**/*.test.{ts,tsx}",
    ],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
});
