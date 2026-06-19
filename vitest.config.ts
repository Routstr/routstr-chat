import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/postcss.config.mjs"],
    environment: "node",
    include: [
      "sdk/__tests__/**/*.test.ts",
      "features/**/__tests__/**/*.test.ts",
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
