import { defineWorkspace } from "vitest/config";
import base from "./vitest.config";

// unit: everything that needs no outside service, fast.
// money: *.mint.test.ts, against the kit's real FakeWallet mints, relay and routstr-core
// (started for the run if the kit runner did not already start them; see tests/kit).
export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: { name: "unit", exclude: ["**/*.mint.test.ts"] },
  },
  {
    ...base,
    test: {
      ...base.test,
      name: "money",
      include: ["**/*.mint.test.ts"],
      globalSetup: ["tests/kit/vitest.setup.ts"],
      testTimeout: 60_000,
      hookTimeout: 120_000,
    },
  },
]);
