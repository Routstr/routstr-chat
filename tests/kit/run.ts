// The test kit's one command.
//
//   pnpm test               unit + money tests
//   pnpm test unit [args]   the same, args go to vitest (e.g. a file filter)
//   pnpm kit up             start the stack and print its env, until Ctrl-C
//
// Shared machine rules, built in: before a step it waits until enough memory is free
// (KIT_MIN_FREE_MB, default 1536), then takes the light lock (vitest) or the heavy lock
// (browser runs). The locks are files named .light.lock / .heavy.lock in a parent
// folder of this checkout, shared by every checkout below it; KIT_LIGHT_LOCK / KIT_HEAVY_LOCK
// name other files, "" turns a lock off. Tests run inside a network namespace with only
// loopback (unshare -rn) when the system allows it, so nothing can reach the internet.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    const holder = spawn("flock", [file, "-c", "echo held; exec cat"], {
      stdio: ["pipe", "pipe", "inherit"],
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
    try {
      return await fn();
    } finally {
      release();
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
  opts: { env?: Record<string, string>; sealed?: boolean } = {}
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
          { stdio: "inherit", env, cwd: ROOT }
        )
      : spawn(cmd, args, { stdio: "inherit", env, cwd: ROOT });
  const forward = (sig: NodeJS.Signals) => child.kill(sig);
  process.on("SIGINT", forward).on("SIGTERM", forward);
  return new Promise((resolve) =>
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forward).off("SIGTERM", forward);
      resolve(code ?? (signal ? 1 : 0));
    })
  );
}

// ---------- steps ----------

async function unit(args: string[]): Promise<number> {
  // a stack from `kit up` lives outside any namespace, so tests pointed at it run unsealed
  const sealed = !process.env.KIT_MINT_URL;
  return withLock("light", () =>
    run(path.join(BIN, "vitest"), ["run", ...args], { sealed })
  );
}

async function up(): Promise<number> {
  await waitForMemory();
  const stack = await startStack({ log: say });
  const vars = envVars(stack.env);
  say(
    "stack is up; paste these to point tests or a dev session at it, Ctrl-C to stop:"
  );
  for (const [k, v] of Object.entries(vars)) console.log(`export ${k}=${v}`);
  await new Promise<void>((resolve) =>
    process.once("SIGINT", resolve).once("SIGTERM", resolve)
  );
  await stack.stop();
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command = "test", ...rest] = argv;
  if (unsealed) say("KIT_NO_SEAL: tests run without the network seal");
  if (command === "up") return up();
  if (command !== "test") throw new Error(`unknown command ${command}`);
  const [step, ...args] = rest;
  if (step === "unit") return unit(args);
  if (step) throw new Error(`unknown step ${step}`);
  return unit([]);
}

if (require.main === module) {
  if (!os.platform().startsWith("linux"))
    say("the locks and the network seal need Linux");
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[kit] ${(e as Error).message}`);
      process.exit(1);
    }
  );
}
