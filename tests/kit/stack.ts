// Starts the local stack every test shares: two FakeWallet mints, a Nostr relay, a fake LLM
// upstream and real routstr-core in front of it. All on free ports, all on this machine.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateSecretKey, nip19 } from "nostr-tools";
import { startCore } from "./services/core";
import { endLeftovers } from "./services/procs";
import { startMint } from "./services/mint";
import { startRelay } from "./services/relay";
import { startUpstream } from "./services/upstream";

export interface KitEnv {
  dir: string; // logs and databases of this run (kept until a later run finds its process gone)
  mintUrl: string; // the wallet's mint; core accepts it; melts settle
  invoiceMintUrl: string; // a second mint, for Lightning invoices to pay
  relayUrl: string;
  upstreamUrl: string;
  coreUrl: string | null; // routstr-core, with a trailing slash like the app stores it; null if not started
}

export interface StackOptions {
  core?: boolean; // default true: routstr-core from KIT_CORE_DIR
  log?: (line: string) => void;
}

export interface Stack {
  env: KitEnv;
  stop(): Promise<void>;
}

const RUNS = path.join(os.tmpdir(), "routstr-kit");

/**
 * Removes the folders of earlier runs whose process is gone (a live `kit up` keeps its own),
 * after ending any mint or core such a run left running.
 */
function pruneRuns() {
  const alive = (pid: number) => {
    try {
      return process.kill(pid, 0);
    } catch {
      return false;
    }
  };
  for (const name of fs.existsSync(RUNS) ? fs.readdirSync(RUNS) : []) {
    const dir = path.join(RUNS, name);
    const pidFile = path.join(dir, "pid");
    if (!fs.existsSync(pidFile)) {
      if (Date.now() - fs.statSync(dir).mtimeMs > 600_000)
        fs.rmSync(dir, { recursive: true, force: true });
      continue; // a run being set up right now
    }
    if (alive(Number(fs.readFileSync(pidFile, "utf8")))) continue;
    endLeftovers(dir, path.join(dir, "pids"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function startStack(opts: StackOptions = {}): Promise<Stack> {
  const log = opts.log ?? (() => {});
  pruneRuns();
  fs.mkdirSync(RUNS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(RUNS, "run-"));
  fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
  const pidFile = path.join(dir, "pids");
  const stops: (() => Promise<void>)[] = [];
  const stop = async () => {
    for (const s of stops.reverse()) await s().catch(() => {});
  };
  try {
    const t0 = Date.now();
    const started = await Promise.allSettled([
      startRelay().then((s) => (stops.push(s.close), s)),
      startUpstream().then((s) => (stops.push(s.close), s)),
      startMint({ dir: path.join(dir, "mint"), pidFile }).then(
        (s) => (stops.push(s.stop), s)
      ),
      startMint({ dir: path.join(dir, "invoice-mint"), pidFile }).then(
        (s) => (stops.push(s.stop), s)
      ),
    ]);
    const failed = started.find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const [relay, upstream, mint, invoiceMint] = started.map(
      (r) => (r as PromiseFulfilledResult<unknown>).value
    ) as [
      Awaited<ReturnType<typeof startRelay>>,
      Awaited<ReturnType<typeof startUpstream>>,
      Awaited<ReturnType<typeof startMint>>,
      Awaited<ReturnType<typeof startMint>>,
    ];
    log(
      `mints, relay and upstream up in ${((Date.now() - t0) / 1000).toFixed(1)} s`
    );
    let coreUrl: string | null = null;
    if (opts.core !== false) {
      const coreDir = process.env.KIT_CORE_DIR;
      if (!coreDir)
        throw new Error(
          "set KIT_CORE_DIR to a routstr-core checkout with a .venv (uv sync --frozen --no-dev), or start without core"
        );
      const core = await startCore({
        coreDir,
        dir: path.join(dir, "core"),
        pidFile,
        mintUrls: [mint.url],
        upstreamUrl: upstream.url,
        relayUrls: [relay.url],
        nsec: nip19.nsecEncode(generateSecretKey()),
      });
      stops.push(core.stop);
      coreUrl = `${core.url}/`;
      log(`routstr-core up in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    return {
      env: {
        dir,
        mintUrl: mint.url,
        invoiceMintUrl: invoiceMint.url,
        relayUrl: relay.url,
        upstreamUrl: upstream.url,
        coreUrl,
      },
      stop,
    };
  } catch (e) {
    await stop();
    throw new Error(`${(e as Error).message}\n(logs kept in ${dir})`);
  }
}

const VARS = {
  dir: "KIT_DIR",
  mintUrl: "KIT_MINT_URL",
  invoiceMintUrl: "KIT_INVOICE_MINT_URL",
  relayUrl: "KIT_RELAY_URL",
  upstreamUrl: "KIT_UPSTREAM_URL",
  coreUrl: "KIT_CORE_URL",
} as const;

export function envVars(env: KitEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(VARS).map(([k, v]) => [v, env[k as keyof KitEnv] ?? ""])
  );
}

export function envFromProcess(): KitEnv | undefined {
  if (!process.env.KIT_MINT_URL) return undefined;
  const get = (k: keyof KitEnv) => process.env[VARS[k]] || "";
  return {
    dir: get("dir"),
    mintUrl: get("mintUrl"),
    invoiceMintUrl: get("invoiceMintUrl"),
    relayUrl: get("relayUrl"),
    upstreamUrl: get("upstreamUrl"),
    coreUrl: get("coreUrl") || null,
  };
}
