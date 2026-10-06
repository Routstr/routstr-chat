// The test kit's one command.
//
//   pnpm test               unit + money tests, then the in-app tests
//   pnpm test unit [args]   vitest only (args go to vitest, e.g. a file filter)
//   pnpm test app [args]    in-app tests only (args go to playwright, e.g. a file or -g name)
//   pnpm kit up             start the stack and print its env, until Ctrl-C
//   pnpm kit locks          who holds and who waits for the locks: pid, worktree, command, age
//   pnpm kit build [dir]    build a checkout's out/ (with the kit's provider address)
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
  process.on("SIGINT", forward).on("SIGTERM", forward);
  return new Promise((resolve, reject) =>
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forward).off("SIGTERM", forward);
      if (stopped) reject(new Error(`stopped by ${stopped}`));
      else resolve(code ?? (signal ? 1 : 0));
    })
  );
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

/** Builds a checkout's out/ unless no source changed since its last kit build. Returns the folder. */
async function build(dir = ROOT): Promise<string> {
  const out = path.join(dir, "out");
  const stampFile = path.join(out, ".kit-build");
  // the build names a fixed provider URL; the sealed browser forwards it to the run's core
  const env = {
    NEXT_PUBLIC_ROUTSTR_PROVIDERS: PROVIDER_ALIAS,
    NEXT_TELEMETRY_DISABLED: "1",
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

/** Inside the (sealed) step: stack + app server + playwright. */
async function appInside(args: string[]): Promise<number> {
  const stack = await startStack({ log: say });
  const server = process.env.KIT_APP_URL
    ? undefined
    : await serveStatic(process.env.KIT_APP_OUT ?? path.join(ROOT, "out"));
  try {
    return await run(
      path.join(BIN, "playwright"),
      ["test", "-c", "tests/app/playwright.config.ts", ...args],
      {
        env: {
          ...envVars(stack.env),
          KIT_APP_URL: process.env.KIT_APP_URL ?? server!.url,
        },
      }
    );
  } finally {
    await server?.close();
    await stack.stop();
  }
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

async function main(argv: string[]): Promise<number> {
  const [command = "test", ...rest] = argv;
  if (unsealed && command !== "__app")
    say("KIT_NO_SEAL: tests run without the network seal");
  if (command === "__app") return appInside(rest);
  if (command === "up") return up();
  if (command === "locks") return locks();
  if (command === "build")
    return withLock("heavy", () => build(path.resolve(rest[0] ?? ROOT))).then(
      () => 0
    );
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
