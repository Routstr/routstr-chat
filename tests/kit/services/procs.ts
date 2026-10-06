// The stack's processes (mints, core) run in their own process groups so stopping one also
// ends its children (uv's python). That also means a Ctrl-C to the terminal does not reach
// them, so they are ended here when this process exits or is told to stop, and a later run
// ends any that a killed run left behind (see pruneRuns in ../stack.ts).
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import fs from "node:fs";

const live = new Set<number>();

function endAll() {
  for (const pid of live) signalGroup(pid, "SIGTERM");
}

function signalGroup(pid: number, sig: NodeJS.Signals) {
  try {
    process.kill(-pid, sig);
  } catch {
    /* already gone */
  }
}

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  process.on("exit", endAll);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(sig, () => {
      endAll();
      // nobody else handles it: end the way the signal would have
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
    });
}

/** Starts a long-running service in its own process group; `pidFile` lists it for cleanup. */
export function spawnService(
  cmd: string,
  args: string[],
  opts: SpawnOptions & { cwd: string },
  pidFile: string
): ChildProcess {
  hook();
  const child = spawn(cmd, args, { ...opts, detached: true });
  if (child.pid) {
    live.add(child.pid);
    fs.appendFileSync(pidFile, `${child.pid}\n`);
    child.once("exit", () => live.delete(child.pid!));
  }
  return child;
}

/** Ends a service's whole group: SIGTERM, then SIGKILL after `graceMs`. */
export async function stopService(
  child: ChildProcess,
  graceMs = 3000
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  signalGroup(child.pid, "SIGTERM");
  const timer = setTimeout(() => signalGroup(child.pid!, "SIGKILL"), graceMs);
  await exited;
  clearTimeout(timer);
}

/**
 * Ends the services a dead run left behind. A pid is only ended while its working folder is
 * still inside that run's folder, so a reused pid of some other program is never touched.
 */
export function endLeftovers(runDir: string, pidFile: string) {
  if (!fs.existsSync(pidFile)) return;
  for (const pid of fs
    .readFileSync(pidFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(Number)) {
    try {
      if (fs.readlinkSync(`/proc/${pid}/cwd`).startsWith(runDir))
        signalGroup(pid, "SIGKILL");
    } catch {
      /* not running */
    }
  }
}
