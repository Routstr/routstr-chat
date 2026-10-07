// The test kit's one command.
//
//   pnpm test               unit + money tests, then the in-app tests
//   pnpm test unit [args]   vitest only (args go to vitest, e.g. a file filter)
//   pnpm test app [args]    in-app tests only (args go to playwright, e.g. a file or -g name)
//   pnpm kit up             start the stack and print its env, until Ctrl-C
//   pnpm kit locks          who holds and who waits for the locks: pid, worktree, command, age
//   pnpm kit build [dir]    build a checkout's out/ (with the kit's provider address)
//   pnpm kit mutate <file>  break the code on purpose and check the tests notice (see mutate.ts)
//   pnpm kit perf ...       measure the app (see tests/perf/perf.ts)
//   pnpm kit parity --main-out <dir>   the parity checks on main's build and on v2
//
// Shared machine rules, built in: before a step it waits until enough memory is free
// (KIT_MIN_FREE_MB, default 1536), then takes the light lock (vitest) or the heavy lock (app
// build, browser runs). The locks are files named .light.lock / .heavy.lock in a parent
// folder of this checkout, shared by every checkout below it; KIT_LIGHT_LOCK / KIT_HEAVY_LOCK
// name other files, "" turns a lock off. Tests run inside a network namespace with only
// loopback (unshare -rn) when the system allows it, so nothing can reach the internet.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  restoreLeftovers,
  runBatches,
  type Mutation,
  type Outcome,
} from "./mutate";
import { PROVIDER_ALIAS } from "./net";
import { serveStatic } from "./services/static";
import { envVars, startStack } from "./stack";

const ROOT = path.resolve(__dirname, "../..");
const BIN = path.join(ROOT, "node_modules", ".bin");
const say = (line: string) => console.log(`[kit] ${line}`);

// ---------- shared-machine guards ----------

export function lockFile(kind: "light" | "heavy"): string | undefined {
  const env = process.env[`KIT_${kind.toUpperCase()}_LOCK`];
  if (env !== undefined) return env || undefined;
  for (
    let dir = path.dirname(ROOT);
    dir !== path.dirname(dir);
    dir = path.dirname(dir)
  ) {
    const file = path.join(dir, `.${kind}.lock`);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

function freeMb(): number {
  const line = fs
    .readFileSync("/proc/meminfo", "utf8")
    .match(/MemAvailable:\s+(\d+) kB/);
  return line ? Number(line[1]) / 1024 : Infinity;
}

async function waitForMemory(): Promise<void> {
  const min = Number(process.env.KIT_MIN_FREE_MB ?? 1536);
  for (let warned = false; freeMb() < min; warned = true) {
    if (!warned)
      say(`waiting: ${Math.round(freeMb())} MB free, need ${min} MB`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

/** True when a process that started this one holds `file` open (e.g. `flock <file> pnpm test`). */
function heldAbove(file: string): boolean {
  const target = fs.realpathSync(file);
  for (let pid = process.ppid; pid > 1; ) {
    try {
      for (const fd of fs.readdirSync(`/proc/${pid}/fd`))
        if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === target) return true;
      pid = Number(
        fs
          .readFileSync(`/proc/${pid}/stat`, "utf8")
          .split(") ")[1]
          .split(" ")[1]
      );
    } catch {
      return false;
    }
  }
  return false;
}

/** Runs `fn` while holding the lock. The lock is released when fn ends or this process dies. */
export async function withLock<T>(
  kind: "light" | "heavy",
  fn: () => Promise<T>
): Promise<T> {
  const file = lockFile(kind);
  // taking it again under a holder above us would wait forever
  if (file && heldAbove(file)) {
    say(`already inside the ${kind} lock`);
    return fn();
  }
  for (;;) {
    await waitForMemory();
    if (!file) return fn();
    // flock holds the lock while `cat` reads our stdin; it ends when we close stdin or die
    // its own process group, so a Ctrl-C at the terminal cannot drop the lock mid-step
    const holder = spawn("flock", [file, "-c", "echo held; exec cat"], {
      stdio: ["pipe", "pipe", "inherit"],
      detached: true,
    });
    const waiting = setTimeout(
      () => say(`waiting for the ${kind} lock (${file})`),
      2000
    );
    await new Promise<void>((resolve, reject) => {
      holder.stdout!.once("data", () => resolve());
      holder.once("exit", (code) =>
        reject(new Error(`flock exited with ${code}`))
      );
    });
    clearTimeout(waiting);
    const release = () => holder.stdin!.end();
    if (freeMb() < Number(process.env.KIT_MIN_FREE_MB ?? 1536)) {
      release(); // memory dropped while we waited for the lock: let it recover first
      continue;
    }
    const held = Date.now();
    try {
      return await fn();
    } finally {
      release();
      const minutes = (Date.now() - held) / 60_000;
      if (minutes > 10)
        say(
          `held the ${kind} lock ${minutes.toFixed(1)} minutes; keep one hold under 10`
        );
    }
  }
}

// ---------- running things ----------

const unsealed = !!process.env.KIT_NO_SEAL; // only where namespaces are not allowed
const sealable =
  !unsealed &&
  spawnSync("unshare", ["-rn", "sh", "-c", "ip link set lo up"], {
    stdio: "ignore",
  }).status === 0;

/** Runs a command; with `sealed`, inside a network namespace that only has loopback. */
function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; sealed?: boolean; cwd?: string } = {}
): Promise<number> {
  const env = { ...process.env, ...opts.env };
  if (opts.sealed && !sealable && !unsealed)
    throw new Error(
      "cannot seal the network here (unshare -rn failed); KIT_NO_SEAL=1 runs without the seal"
    );
  const child: ChildProcess =
    opts.sealed && sealable
      ? spawn(
          "unshare",
          [
            "-rn",
            "sh",
            "-c",
            'ip link set lo up && exec "$0" "$@"',
            cmd,
            ...args,
          ],
          { stdio: "inherit", env, cwd: opts.cwd ?? ROOT }
        )
      : spawn(cmd, args, { stdio: "inherit", env, cwd: opts.cwd ?? ROOT });
  // Ctrl-C: pass it on, then stop the whole kit (not just this step) once the child is gone;
  // the error unwinds through the finally blocks that restore files and release locks
  let stopped: NodeJS.Signals | undefined;
  const forward = (sig: NodeJS.Signals) => {
    stopped = sig;
    child.kill(sig);
  };
  // SIGHUP too: a closed terminal must still restore files and release locks
  process.on("SIGINT", forward).on("SIGTERM", forward).on("SIGHUP", forward);
  return new Promise((resolve, reject) =>
    child.on("exit", (code, signal) => {
      process
        .off("SIGINT", forward)
        .off("SIGTERM", forward)
        .off("SIGHUP", forward);
      if (stopped) reject(new Error(`stopped by ${stopped}`));
      else resolve(code ?? (signal ? 1 : 0));
    })
  );
}

/** Removes `--name value` from args and returns the value. */
function take(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args.splice(i, 2)[1];
}

const tsx = (script: string, args: string[]): [string, string[]] => [
  path.join(BIN, "tsx"),
  [script, ...args],
];

// ---------- steps ----------

async function unit(args: string[]): Promise<number> {
  // a stack from `kit up` lives outside any namespace, so tests pointed at it run unsealed
  const sealed = !process.env.KIT_MINT_URL;
  return withLock("light", () =>
    run(path.join(BIN, "vitest"), ["run", ...args], { sealed })
  );
}

/** Newest change among the files that go into the app build. */
function sourceStamp(dir: string): number {
  const files = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: dir,
    encoding: "utf8",
  }).stdout.split("\n");
  let newest = 0;
  for (const f of files) {
    // next-env.d.ts is rewritten by every next dev and next build
    if (
      !f ||
      f.startsWith("tests/") ||
      f.endsWith(".md") ||
      f === "next-env.d.ts"
    )
      continue;
    try {
      newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs);
    } catch {
      /* deleted in the working tree */
    }
  }
  return newest;
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Builds a checkout's out/ unless no source changed since its last kit build. Returns the folder. */
async function build(dir = ROOT): Promise<string> {
  const out = path.join(dir, "out");
  const stampFile = path.join(out, ".kit-build");
  // the build names a fixed provider URL; the sealed browser forwards it to the run's core
  const env = {
    NEXT_PUBLIC_ROUTSTR_PROVIDERS: PROVIDER_ALIAS,
    NEXT_TELEMETRY_DISABLED: "1",
    // a build for /v2 beside main (NEXT_PUBLIC_BASE_PATH=/v2) is served and tested under it
    ...(BASE_PATH ? { NEXT_PUBLIC_BASE_PATH: BASE_PATH } : {}),
  };
  const sources = sourceStamp(dir); // taken before: a file saved during the build counts as new
  const stamp = { env, sources };
  try {
    const last = JSON.parse(fs.readFileSync(stampFile, "utf8"));
    if (
      JSON.stringify(last.env) === JSON.stringify(env) &&
      last.sources >= sources
    )
      return out;
  } catch {
    /* never built by the kit */
  }
  say(`building the app (next build in ${dir})`);
  // next directly: pnpm may first try the npm registry while this holds the heavy lock
  const code = await run(
    path.join(dir, "node_modules", ".bin", "next"),
    ["build", "--webpack"],
    { env, cwd: dir }
  );
  if (code !== 0) throw new Error(`next build failed (${code})`);
  fs.writeFileSync(stampFile, JSON.stringify(stamp));
  return out;
}

/** In-app tests on this checkout's build, KIT_APP_OUT (another build), or KIT_APP_URL (a dev server). */
async function app(args: string[]): Promise<number> {
  const appUrl = process.env.KIT_APP_URL;
  if (!appUrl && !process.env.KIT_APP_OUT)
    await withLock("heavy", () => build());
  // a dev server outside the namespace is only reachable unsealed; the browser stays sealed
  return withLock("heavy", () =>
    run(...tsx(__filename, ["__app", ...args]), { sealed: !appUrl })
  );
}

/**
 * Inside the (sealed) step: stack + app server(s) + playwright. KIT_PW_CONFIG picks the
 * Playwright config (default: the in-app tests); KIT_MAIN_OUT also serves main's build as
 * KIT_MAIN_URL (parity).
 */
async function appInside(args: string[]): Promise<number> {
  const stack = await startStack({ log: say });
  const server = process.env.KIT_APP_URL
    ? undefined
    : await serveStatic(process.env.KIT_APP_OUT ?? path.join(ROOT, "out"), BASE_PATH);
  const mainServer = process.env.KIT_MAIN_OUT
    ? await serveStatic(process.env.KIT_MAIN_OUT)
    : undefined;
  const config = process.env.KIT_PW_CONFIG ?? "tests/app/playwright.config.ts";
  try {
    return await run(
      path.join(BIN, "playwright"),
      ["test", "-c", config, ...args],
      {
        env: {
          ...envVars(stack.env),
          KIT_APP_URL: process.env.KIT_APP_URL ?? server!.url,
          ...(mainServer ? { KIT_MAIN_URL: mainServer.url } : {}),
        },
      }
    );
  } finally {
    await server?.close();
    await mainServer?.close();
    await stack.stop();
  }
}

/** The same checks on main's build and on v2 (this checkout's build, or --v2-out). */
async function parity(args: string[]): Promise<number> {
  const mainOut = take(args, "main-out");
  if (!mainOut)
    throw new Error("parity needs main's static build: --main-out <dir>");
  const v2Out =
    take(args, "v2-out") ?? (await withLock("heavy", () => build()));
  const env = {
    KIT_PW_CONFIG: "tests/parity/playwright.config.ts",
    KIT_MAIN_OUT: path.resolve(mainOut),
    KIT_APP_OUT: path.resolve(v2Out),
  };
  // one hold per app, so no hold runs long; v2 runs even when main fails a check
  let code = 0;
  for (const project of ["main", "v2"]) {
    const projectCode = await withLock("heavy", () =>
      run(...tsx(__filename, ["__app", "--project", project, ...args]), {
        env,
        sealed: true,
      })
    );
    code ||= projectCode;
  }
  return code;
}

/** Who holds and who waits for each lock, from /proc/locks (a waiter's line starts with ->). */
function locks(): number {
  const table = fs.readFileSync("/proc/locks", "utf8").split("\n");
  const tick = Number(
    spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout
  );
  const uptime = Number(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  const read = (pid: string, what: string) => {
    try {
      return what === "cwd"
        ? fs.readlinkSync(`/proc/${pid}/cwd`)
        : fs.readFileSync(`/proc/${pid}/${what}`, "utf8");
    } catch {
      return "";
    }
  };
  const age = (pid: string) => {
    const started = Number(read(pid, "stat").split(") ")[1]?.split(" ")[19]);
    const min = Math.round((uptime - started / tick) / 60);
    return min >= 60 ? `${Math.floor(min / 60)}h${min % 60}m` : `${min}m`;
  };
  // one line, and node's loader flags (tsx) left out so the script shows
  const command = (pid: string) =>
    read(pid, "cmdline")
      .replace(/[\0\s]+/g, " ")
      .replace(/^\S*\/node (--(require|import) \S+ )+/, "node ")
      .trim();
  say(`${Math.round(freeMb())} MB free`);
  for (const kind of ["heavy", "light"] as const) {
    const file = lockFile(kind);
    if (!file) continue;
    const inode = fs.statSync(file).ino;
    for (const line of table) {
      const m = line.match(
        /^\d+:\s+(-> )?FLOCK\s+\S+\s+\S+\s+(\d+) [\da-f]+:[\da-f]+:(\d+) /
      );
      if (!m || Number(m[3]) !== inode) continue;
      const pid = m[2];
      // the kit's own holder is a bare flock: what it holds the lock for is its parent's job,
      // and with no parent left its run has ended (it lets go the moment it gets the lock)
      let job = command(pid);
      if (job.endsWith("echo held; exec cat")) {
        const parent = command(read(pid, "stat").split(") ")[1]?.split(" ")[1]);
        job = /^(\/usr\/lib\/systemd|\/sbin\/init)/.test(parent)
          ? "(left by a run that ended)"
          : parent;
      }
      const cwd = read(pid, "cwd");
      const inside = path.relative(path.dirname(file), cwd);
      const where = inside.startsWith("..")
        ? cwd.replace(os.homedir(), "~")
        : inside || ".";
      console.log(
        `${kind}  ${m[1] ? "waits" : "holds"}  pid ${pid}  ${age(pid)}  ${where}  ${job.slice(0, 120)}`
      );
    }
  }
  return 0;
}

async function up(): Promise<number> {
  await waitForMemory();
  const stack = await startStack({ log: say });
  const vars = envVars(stack.env);
  say(
    "stack is up; paste these to point tests or a dev session at it, Ctrl-C to stop:"
  );
  // a dev server started with this enables the kit's core without a Routstr review
  vars.NEXT_PUBLIC_ROUTSTR_PROVIDERS = stack.env.coreUrl ?? "";
  for (const [k, v] of Object.entries(vars)) console.log(`export ${k}=${v}`);
  await new Promise<void>((resolve) =>
    process.once("SIGINT", resolve).once("SIGTERM", resolve)
  );
  await stack.stop();
  return 0;
}

/**
 * Runs one mutation's tests and reads their report: vitest args, or ["app", ...] for in-app
 * tests. Those need KIT_APP_URL (a dev server, so a change to the app shows without a
 * rebuild) or, for changes to the kit itself, KIT_APP_OUT (a build).
 */
async function check(args: string[]): Promise<Outcome> {
  const report = path.join(
    os.tmpdir(),
    `kit-mutate-${process.pid}-${Date.now()}.json`
  );
  try {
    let code: number;
    if (args[0] !== "app") {
      code = await run(
        path.join(BIN, "vitest"),
        [
          "run",
          "--reporter=default",
          "--reporter=json",
          `--outputFile.json=${report}`,
          ...args,
        ],
        { sealed: true }
      );
    } else {
      const appUrl = process.env.KIT_APP_URL;
      if (!appUrl && !process.env.KIT_APP_OUT)
        throw new Error(
          "in-app mutations need KIT_APP_URL (a dev server) or KIT_APP_OUT (a build, for kit changes)"
        );
      code = await run(
        ...tsx(__filename, ["__app", "--reporter=list,json", ...args.slice(1)]),
        { sealed: !appUrl, env: { PLAYWRIGHT_JSON_OUTPUT_NAME: report } }
      );
    }
    if (!fs.existsSync(report))
      return { error: `no test report (exit ${code})` };
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    // vitest: numFailedTests; playwright: stats.unexpected. A file that could not load or a
    // setup that crashed fails no test, so it is an error, not a catch.
    const failed: number = r.numFailedTests ?? r.stats?.unexpected ?? 0;
    const unloaded = (r.testResults ?? []).some(
      (f: { status: string; assertionResults: { status: string }[] }) =>
        f.status === "failed" &&
        !f.assertionResults.some((a) => a.status === "failed")
    );
    const broken = unloaded || r.errors?.length > 0;
    if (broken || (code !== 0 && failed === 0))
      return { error: `the tests could not run (exit ${code})` };
    return { failed };
  } finally {
    fs.rmSync(report, { force: true });
  }
}

/**
 * A file that is mid-mutation would make any other run lie, so refuse to run (at once, not
 * after waiting for the lock: the mutate run may be alive and holding it, or killed).
 */
function refuseLeftovers() {
  for (const dir of [ROOT, process.env.KIT_CORE_DIR]) {
    if (!dir) continue;
    const left = spawnSync(
      "git",
      ["-C", dir, "ls-files", "-o", "--exclude-standard"],
      {
        encoding: "utf8",
      }
    )
      .stdout.split("\n")
      .filter((f) => f.endsWith(".kit-original"));
    if (left.length)
      throw new Error(
        `${left.map((f) => path.join(dir, f)).join(", ")}: a file is mid-mutation. A \`kit mutate\` run is using it (see \`kit locks\`), or one was killed: then \`kit mutate\` with its list puts the original back`
      );
  }
}

async function mutate(file: string): Promise<number> {
  const mutations = JSON.parse(fs.readFileSync(file, "utf8")) as Mutation[];
  // under the lock: another mutate run only changes files while it holds it
  const restored = await withLock("heavy", async () =>
    restoreLeftovers(ROOT, mutations)
  );
  if (restored.length)
    say(`restored files an earlier run left mutated: ${restored.join(", ")}`);
  refuseLeftovers(); // one that another list left
  // the tests must pass before anything is broken, or "caught" means nothing; their time
  // says how many mutations fit in one batch
  const took = new Map<string, number>();
  for (const suite of new Set(mutations.map((m) => JSON.stringify(m.test)))) {
    const outcome = await withLock("heavy", async () => {
      const started = Date.now(); // the run itself, not the wait for the lock
      const outcome = await check(JSON.parse(suite));
      took.set(suite, Date.now() - started);
      return outcome;
    });
    if (!("failed" in outcome) || outcome.failed > 0)
      throw new Error(
        `tests fail before any mutation: ${JSON.parse(suite).join(" ")}`
      );
  }
  const results = await runBatches(
    ROOT,
    mutations,
    10,
    took,
    (fn) => withLock("heavy", fn),
    check,
    say
  );
  const missed = results.filter((r) => !r.caught);
  say(
    `${results.length - missed.length} of ${results.length} mutations caught${missed.length ? `; missed or errors: ${missed.map((r) => r.id).join(", ")}` : ""}`
  );
  return missed.length ? 1 : 0;
}

/** Perf runs, one heavy-lock hold per run so no hold gets long and each run has a quiet machine. */
async function perf(args: string[]): Promise<number> {
  const script = path.join(ROOT, "tests", "perf", "perf.ts");
  if (!args.includes("--driver")) return run(...tsx(script, args)); // just a comparison table
  const runs = Number(take(args, "runs") ?? 5);
  const json = path.resolve(
    take(args, "json") ?? path.join(os.tmpdir(), `kit-perf-${Date.now()}.json`)
  );
  const url = args.includes("--url");
  if (url && fs.existsSync(json))
    throw new Error(
      "a running app (--url) has no version to check runs against: use a new --json"
    );
  // core alone needs no app build; its numbers still want a quiet machine (heavy lock).
  // An app's out/ is built (or found up to date) first, so the numbers are its sources'.
  const coreOnly = args[args.indexOf("--driver") + 1] === "core";
  const outArg = take(args, "out");
  const out =
    url || coreOnly
      ? undefined
      : await withLock("heavy", () =>
          build(outArg ? path.resolve(outArg, "..") : ROOT)
        );
  let code = 0;
  for (let i = 0; i < runs && code === 0; i++) {
    code = await withLock("heavy", () =>
      run(
        ...tsx(script, [
          ...args,
          "--runs",
          "1",
          "--json",
          json,
          ...(out ? ["--out", out] : []),
        ]),
        { sealed: !url }
      )
    );
  }
  say(`results: ${json}`);
  return code;
}

async function main(argv: string[]): Promise<number> {
  const [command = "test", ...rest] = argv;
  if (unsealed && command !== "__app")
    say("KIT_NO_SEAL: tests run without the network seal");
  if (command === "__app") return appInside(rest);
  if (command !== "locks" && command !== "mutate") refuseLeftovers();
  if (command === "up") return up();
  if (command === "locks") return locks();
  if (command === "build")
    return withLock("heavy", () => build(path.resolve(rest[0] ?? ROOT))).then(
      () => 0
    );
  if (command === "mutate") return mutate(rest[0]);
  if (command === "perf") return perf(rest);
  if (command === "parity") return parity(rest);
  if (command !== "test") throw new Error(`unknown command ${command}`);
  const [step, ...args] = rest;
  if (step === "unit") return unit(args);
  if (step === "app") return app(args);
  if (step) throw new Error(`unknown step ${step} (unit or app)`);
  const unitCode = await unit([]);
  const appCode = await app([]);
  return unitCode || appCode;
}

if (require.main === module) {
  if (!os.platform().startsWith("linux"))
    say("the locks and the network seal need Linux");
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[kit] ${(e as Error).message}`);
      process.exit(/^stopped by/.test((e as Error).message) ? 130 : 1);
    }
  );
}
