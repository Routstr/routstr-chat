// A test file the projects do not pick up is a test that silently never runs. This checks
// the unit and money projects together cover every *.test.ts in the checkout, once each.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import workspace from "../../../vitest.workspace";

const root = path.resolve(__dirname, "../../..");
// fs.globSync is in Node 22+; this repo's @types/node is older
const glob = (
  fs as unknown as {
    globSync(pattern: string, opts: { cwd: string }): string[];
  }
).globSync;

it("runs every test file in the checkout, in exactly one project", () => {
  const all = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "*.test.ts", "*.test.tsx"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean);
  const owners = new Map<string, string[]>();
  for (const project of workspace as {
    test: { name: string; include: string[]; exclude?: string[] };
  }[]) {
    const { name, include, exclude = [] } = project.test;
    const skip = new Set(exclude.flatMap((p) => glob(p, { cwd: root })));
    for (const file of include.flatMap((p) => glob(p, { cwd: root })))
      if (!file.includes("node_modules") && !skip.has(file))
        owners.set(file, [...new Set([...(owners.get(file) ?? []), name])]);
  }
  expect(all.filter((f) => !owners.has(f))).toEqual([]); // never run
  expect([...owners].filter(([, names]) => names.length > 1)).toEqual([]); // run twice
});
