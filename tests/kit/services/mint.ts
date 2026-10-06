// A real cashu mint (nutshell) with fake Lightning (FakeWallet): invoices are paid at once,
// melts settle with the state you pick, no real sats ever move. Started with uvx, so the
// only thing it needs is uv and a cached or downloadable cashu==0.20.0.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { freePort, waitFor } from "./util";

export type PayState = "SETTLED" | "FAILED" | "PENDING";

export interface MintOptions {
  dir: string; // fresh database and log live here
  payState?: PayState; // what a melt (paying an invoice) ends as
  inputFeePpk?: number;
  /** true: the uv cache only (sealed runs). Default: try the cache first, then download. */
  offline?: boolean;
}

export interface MintProcess {
  url: string;
  payState: PayState;
  log: string;
  stop(): Promise<void>;
}

const NUTSHELL = [
  "--from",
  "cashu==0.20.0",
  "--with",
  "marshmallow<4",
  "--with",
  "limits<4",
  "mint",
];

export async function startMint(opts: MintOptions): Promise<MintProcess> {
  try {
    return await launch(opts, true);
  } catch (e) {
    if (opts.offline) throw e;
    return launch(opts, false); // first run on this machine: let uv download nutshell
  }
}

async function launch(
  opts: MintOptions,
  offline: boolean
): Promise<MintProcess> {
  const port = await freePort();
  const payState = opts.payState ?? "SETTLED";
  fs.mkdirSync(opts.dir, { recursive: true });
  const log = path.join(opts.dir, "mint.log");
  const out = fs.openSync(log, "w");
  const child: ChildProcess = spawn(
    "uvx",
    [...(offline ? ["--offline"] : []), ...NUTSHELL],
    {
      cwd: opts.dir,
      stdio: ["ignore", out, out],
      detached: true, // own process group, so stop() also ends uv's python child
      env: {
        ...process.env,
        MINT_BACKEND_BOLT11_SAT: "FakeWallet",
        MINT_LISTEN_HOST: "127.0.0.1",
        MINT_LISTEN_PORT: String(port),
        MINT_PRIVATE_KEY: `kit-test-only-${port}`,
        MINT_DATABASE: "./data",
        MINT_INPUT_FEE_PPK: String(opts.inputFeePpk ?? 0),
        FAKEWALLET_DELAY_INCOMING_PAYMENT: "0",
        FAKEWALLET_DELAY_OUTGOING_PAYMENT: "0",
        FAKEWALLET_PAY_INVOICE_STATE: payState,
        FAKEWALLET_PAYMENT_STATE: payState,
      },
    }
  );
  const url = `http://127.0.0.1:${port}`;
  const stop = () => killGroup(child);
  try {
    await waitFor(
      `mint ${payState} (log: ${log})`,
      90_000,
      async () => (await fetch(`${url}/v1/info`)).ok,
      child
    );
  } catch (e) {
    await stop();
    throw e;
  }
  return { url, payState, log, stop };
}

export async function killGroup(
  child: ChildProcess,
  graceMs = 3000
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, sig);
    } catch {
      /* already gone */
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), graceMs);
  await exited;
  clearTimeout(timer);
}
