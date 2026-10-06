import { defineWorkspace } from "vitest/config";
import base from "./vitest.config";

const test = base.test!;

// unit: everything that needs no outside service, fast (vitest.config's files + the kit's).
// money: *.mint.test.ts, against the kit's real FakeWallet mints, relay and routstr-core
// (started for the run if the kit runner did not already start them; see tests/kit). Its
// files run one at a time: they share one stack, so one file's queued upstream behaviour
// must not land in another's request.
// Both list their files in full rather than through `extends`, so nothing depends on how
// vitest merges arrays; tests/kit/__tests__/workspace.test.ts checks no test file is missed.
export default defineWorkspace([
  {
    ...base,
    test: {
      ...test,
      name: "unit",
      include: [...test.include!, "tests/kit/__tests__/*.test.ts"],
      exclude: [...test.exclude!, "**/*.mint.test.ts"],
    },
  },
  {
    ...base,
    test: {
      ...test,
      name: "money",
      include: ["**/*.mint.test.ts"],
      globalSetup: ["tests/kit/vitest.setup.ts"],
      poolOptions: { forks: { singleFork: true } },
      testTimeout: 60_000,
      hookTimeout: 120_000,
    },
  },
]);
