// Breaks the code on purpose, one change at a time, and checks the tests notice.
//
//   pnpm kit mutate <mutations.json>
//
// mutations.json: [{ "id": "keep-change", "file": "features/book/executor.ts",   ($VAR/... works too)
//                    "find": "await commit(add, remove)", "replace": "await commit([], remove)",
//                    "test": ["features/book"] }]
// `find` must appear exactly once in the file. `test` is what to run: vitest args, or
// ["app", ...playwright args] for in-app tests. A mutation is "caught" when at least one test
// fails; a run that cannot test at all (a syntax error, a stack that does not start) is an
// error, not a catch.
//
// Each file is restored right after its run, and on start if an earlier run died midway (the
// original is kept next to it as <file>.kit-original). Runs go in batches of at most 10
// minutes under the heavy lock, released between batches.
import fs from "node:fs";
import path from "node:path";

export interface Mutation {
  id: string;
  file: string;
  find: string;
  replace: string;
  test: string[];
}

/** What a test run said: how many tests failed, or why it could not test. */
export type Outcome = { failed: number } | { error: string };

interface MutationResult {
  id: string;
  caught: boolean;
  seconds: number;
  error?: string;
}

const ORIGINAL = ".kit-original";

/** A path relative to the checkout, or starting with $VAR (e.g. $KIT_CORE_DIR/routstr/...). */
const resolveFile = (root: string, file: string) =>
  path.resolve(
    root,
    file.replace(
      /^\$(\w+)/,
      (_, name: string) => process.env[name] ?? `$${name}`
    )
  );

/** Puts back any file an interrupted run left mutated. Call it holding the heavy lock. */
export function restoreLeftovers(
  root: string,
  mutations: Mutation[]
): string[] {
  const restored: string[] = [];
  for (const file of new Set(mutations.map((m) => resolveFile(root, m.file)))) {
    if (!fs.existsSync(file + ORIGINAL)) continue;
    // only while the file is exactly the original plus one mutation: if someone has edited
    // it since, copying the original back would throw their work away
    const now = fs.readFileSync(file, "utf8");
    const original = fs.readFileSync(file + ORIGINAL, "utf8");
    const mutated = mutations.some(
      (m) =>
        resolveFile(root, m.file) === file &&
        now === original.replace(m.find, () => m.replace)
    );
    if (!mutated)
      throw new Error(
        `${path.relative(root, file)} has a ${ORIGINAL} copy from a run that died, but no longer holds a mutation: compare the two and delete the copy`
      );
    fs.copyFileSync(file + ORIGINAL, file);
    fs.rmSync(file + ORIGINAL);
    restored.push(path.relative(root, file));
  }
  return restored;
}

/** Applies one mutation, runs `check`, and always restores the file. */
async function runMutation(
  root: string,
  m: Mutation,
  check: (args: string[]) => Promise<Outcome>
): Promise<MutationResult> {
  const file = resolveFile(root, m.file);
  const original = fs.readFileSync(file, "utf8");
  const hits = original.split(m.find).length - 1;
  if (hits !== 1)
    return {
      id: m.id,
      caught: false,
      seconds: 0,
      error: `"find" appears ${hits} times in ${m.file}`,
    };
  const started = Date.now();
  const mutated = original.replace(m.find, () => m.replace);
  fs.writeFileSync(file + ORIGINAL, original);
  fs.writeFileSync(file, mutated);
  try {
    const outcome = await check(m.test);
    return {
      id: m.id,
      caught: "failed" in outcome && outcome.failed > 0,
      seconds: Math.round((Date.now() - started) / 1000),
      ...("error" in outcome ? { error: outcome.error } : {}),
    };
  } finally {
    // someone saved the file during the run: keep their edit, and the original beside it
    if (fs.readFileSync(file, "utf8") !== mutated)
      throw new Error(
        `${m.file} changed during its mutation run; the original is in ${m.file}${ORIGINAL}`
      );
    fs.writeFileSync(file, original);
    fs.rmSync(file + ORIGINAL);
  }
}

/**
 * Splits the list into batches that each take the lock again. A batch runs at least one
 * mutation, then only those that fit before `minutes` are up, going by the slowest run of
 * the same tests so far (`baselineMs` for the run before any mutation).
 */
export async function runBatches(
  root: string,
  mutations: Mutation[],
  minutes: number,
  baselineMs: Map<string, number>,
  inLock: <T>(fn: () => Promise<T>) => Promise<T>,
  check: (args: string[]) => Promise<Outcome>,
  log: (line: string) => void
): Promise<MutationResult[]> {
  const results: MutationResult[] = [];
  const slowest = new Map(baselineMs);
  const suite = (m: Mutation) => JSON.stringify(m.test);
  let next = 0;
  while (next < mutations.length) {
    await inLock(async () => {
      const deadline = Date.now() + minutes * 60_000;
      do {
        const m = mutations[next++];
        const r = await runMutation(root, m, check);
        slowest.set(
          suite(m),
          Math.max(slowest.get(suite(m)) ?? 0, r.seconds * 1000)
        );
        results.push(r);
        log(
          `${r.error ? "ERROR  " : r.caught ? "caught " : "MISSED "} ${m.id} (${r.seconds} s)${r.error ? `: ${r.error}` : ""}`
        );
      } while (
        next < mutations.length &&
        Date.now() + (slowest.get(suite(mutations[next])) ?? 0) < deadline
      );
    });
  }
  return results;
}
