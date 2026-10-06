// Real routstr-core from a local checkout (KIT_CORE_DIR, with its .venv), on a free port,
// paid through the kit mint and answering from the kit's fake upstream.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { killGroup } from "./mint";
import { API_KEY } from "./upstream";
import { freePort, waitFor } from "./util";

export interface CoreOptions {
  coreDir: string;
  dir: string; // database and log
  mintUrls: string[];
  upstreamUrl: string;
  relayUrls: string[];
  nsec: string; // the node's Nostr key, for its provider announcement
  env?: Record<string, string>;
}

export interface CoreProcess {
  url: string;
  log: string;
  stop(): Promise<void>;
}

const LAUNCHER = path.join(__dirname, "core_launcher.py");

export async function startCore(opts: CoreOptions): Promise<CoreProcess> {
  const python = path.join(opts.coreDir, ".venv", "bin", "python");
  if (!fs.existsSync(python))
    throw new Error(
      `no routstr-core venv at ${python}: set KIT_CORE_DIR to a routstr-core checkout and run "uv sync --frozen --no-dev" in it`
    );
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  fs.mkdirSync(opts.dir, { recursive: true });
  // core runs its migrations and writes logs/ relative to where it starts, so start it in
  // the run folder with the checkout's migrations linked in
  for (const name of ["alembic.ini", "migrations"])
    fs.symlinkSync(path.join(opts.coreDir, name), path.join(opts.dir, name));
  const log = path.join(opts.dir, "core.log");
  const out = fs.openSync(log, "w");
  const child = spawn(python, [LAUNCHER], {
    cwd: opts.dir,
    stdio: ["ignore", out, out],
    detached: true,
    env: {
      ...process.env,
      PYTHONPATH: opts.coreDir,
      KIT_CORE_PORT: String(port),
      KIT_UPSTREAM_URL: opts.upstreamUrl,
      DATABASE_URL: `sqlite+aiosqlite:///${path.join(opts.dir, "core.db")}`,
      ROUTSTR_SECRET_KEY: "",
      UPSTREAM_BASE_URL: `${opts.upstreamUrl}/v1`,
      UPSTREAM_API_KEY: API_KEY,
      CASHU_MINTS: opts.mintUrls.join(","),
      NAME: "Kit Node",
      DESCRIPTION: "routstr-core run by the chat test kit",
      HTTP_URL: url,
      NSEC: opts.nsec,
      RELAYS: opts.relayUrls.join(","),
      ENABLE_ANALYTICS_SHARING: "false",
      LITELLM_LOCAL_MODEL_COST_MAP: "True",
      MIN_PAYOUT_SAT: "100000000",
      LOG_LEVEL: "INFO",
      ...opts.env,
    },
  });
  const stop = () => killGroup(child);
  try {
    await waitFor(
      `routstr-core (log: ${log})`,
      120_000,
      async () => {
        const res = await fetch(`${url}/v1/models`);
        if (!res.ok) return false;
        const { data } = (await res.json()) as { data?: unknown[] };
        return (data?.length ?? 0) > 0;
      },
      child
    );
  } catch (e) {
    await stop();
    throw e;
  }
  return { url, log, stop };
}
