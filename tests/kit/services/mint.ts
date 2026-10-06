// A real cashu mint (nutshell) with fake Lightning (FakeWallet): invoices are paid at once,
// melts settle with the state you pick, no real sats ever move. Started with uvx, so the
// only thing it needs is uv and a cached or downloadable cashu==0.20.0.
import fs from "node:fs";
import path from "node:path";
import { spawnService, stopService } from "./procs";
import { freePort, waitFor } from "./util";

export type PayState = "SETTLED" | "FAILED" | "PENDING";

export interface MintOptions {
  dir: string; // fresh database and log live here
  pidFile: string; // the run's list of processes to end if it dies
  payState?: PayState; // what a melt (paying an invoice) ends as
  /** "v2" (default): keyset ids "01…" as nutshell 0.20 makes them; "v1": "00…", as most mints still have */
  keysets?: "v1" | "v2";
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

/** Tries uv's cache first (the only way inside the sealed namespace), then a download. */
export async function startMint(opts: MintOptions): Promise<MintProcess> {
  try {
    return await launch(opts, true);
  } catch {
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
  const child = spawnService(
    "uvx",
    [...(offline ? ["--offline"] : []), ...NUTSHELL],
    {
      cwd: opts.dir,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        MINT_BACKEND_BOLT11_SAT: "FakeWallet",
        MINT_LISTEN_HOST: "127.0.0.1",
        MINT_LISTEN_PORT: String(port),
        MINT_PRIVATE_KEY: `kit-test-only-${port}`,
        MINT_DATABASE: "./data",
        MINT_INPUT_FEE_PPK: "0",
        FAKEWALLET_DELAY_INCOMING_PAYMENT: "0",
        FAKEWALLET_DELAY_OUTGOING_PAYMENT: "0",
        FAKEWALLET_PAY_INVOICE_STATE: payState,
        FAKEWALLET_PAYMENT_STATE: payState,
        // nutshell makes v2 keyset ids from version 0.20 on
        ...(opts.keysets === "v1" ? { VERSION: "0.19.0" } : {}),
      },
    },
    opts.pidFile
  );
  const url = `http://127.0.0.1:${port}`;
  const stop = () => stopService(child);
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
