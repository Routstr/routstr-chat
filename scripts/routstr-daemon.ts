import { createServer, IncomingMessage, ServerResponse } from "http";
import { Readable } from "stream";
import {
  routeRequests,
  createSdkStore,
  createSqliteDriver,
  ModelManager,
  InsufficientBalanceError,
} from "@/sdk";
import {
  createDiscoveryAdapterFromStore,
  createProviderRegistryFromStore,
  createStorageAdapterFromStore,
} from "@/sdk/storage/store";
import { spawn } from "child_process";
import { getDecodedToken } from "@cashu/cashu-ts";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const MOCK_ERROR_CODES: Record<string, number> = {
  // 'https://api.provider.com': 429,
};

if (process.env.NODE_ENV === "test" || process.env.MOCK_ERRORS) {
  const originalFetch = global.fetch;
  global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const urlStr = input instanceof Request ? input.url : input.toString();
    for (const [providerUrl, errorCode] of Object.entries(MOCK_ERROR_CODES)) {
      if (urlStr.includes(providerUrl)) {
        console.log(`[MOCK] Returning ${errorCode} for ${urlStr}`);
        return new Response(JSON.stringify({ error: `${errorCode} Error` }), {
          status: errorCode,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return originalFetch(input, init);
  };
}

const REQUESTS_DIR = join(__dirname, "requests");

async function ensureRequestsDir(): Promise<void> {
  try {
    await mkdir(REQUESTS_DIR, { recursive: true });
  } catch (error) {
    // Directory may already exist
  }
}

function parseArgs(argv: string[]): {
  port: number;
  provider: string | null;
  mode: "xcashu" | "lazyrefund" | "apikeys";
} {
  const portFlagIndex = argv.findIndex((arg) => arg === "--port");
  const providerFlagIndex = argv.findIndex(
    (arg) => arg === "--provider" || arg === "-p"
  );
  const modeFlagIndex = argv.findIndex(
    (arg) => arg === "--mode" || arg === "-m"
  );

  const port =
    portFlagIndex !== -1
      ? Number.parseInt(argv[portFlagIndex + 1] || "8008", 10)
      : 8008;
  const provider =
    providerFlagIndex !== -1 ? argv[providerFlagIndex + 1]?.trim() : null;
  const modeArg = modeFlagIndex !== -1 ? argv[modeFlagIndex + 1]?.trim() : null;
  const mode: "xcashu" | "lazyrefund" | "apikeys" =
    modeArg === "xcashu" || modeArg === "lazyrefund"
      ? modeArg
      : "apikeys";

  return { port, provider, mode };
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function runWalletCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("cocod", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code && code !== 0) {
        reject(
          new Error(stderr.trim() || stdout.trim() || "Wallet CLI failed")
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseBalances(output: string): Record<string, number> {
  const trimmed = output.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed) as Record<
      string,
      { sats?: number } | number
    >;
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(
        Object.entries(parsed).map(([mintUrl, value]) => {
          if (typeof value === "number") {
            return [mintUrl, value];
          }
          if (value && typeof value === "object" && "sats" in value) {
            return [mintUrl, Number(value.sats ?? 0)];
          }
          return [mintUrl, 0];
        })
      );
    }
  } catch {
    // Fall back to line parsing.
  }

  const balances: Record<string, number> = {};
  trimmed
    .split("\n")
    .map((line) => line.trim())
    .forEach((line) => {
      const match = line.match(/^(\S+):\s+(\d+)\s+s$/);
      if (match) {
        balances[match[1]] = Number.parseInt(match[2], 10);
      }
    });
  return balances;
}

function parseMints(output: string): Array<{ url: string; trusted: boolean }> {
  return output
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const urlMatch = line.match(/https?:\/\/\S+/i);
      if (!urlMatch) return null;
      const trustedMatch = line.match(/trusted:\s*(true|false)/i);
      return {
        url: urlMatch[0],
        trusted: trustedMatch
          ? trustedMatch[1].toLowerCase() === "true"
          : false,
      };
    })
    .filter((entry): entry is { url: string; trusted: boolean } =>
      Boolean(entry)
    );
}

function pickTokenLine(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] || "";
}

async function saveRequestBody(
  body: unknown,
  headers: IncomingMessage["headers"],
  path: string,
  method: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `req-${timestamp}.json`;
  const filepath = join(REQUESTS_DIR, filename);
  await writeFile(
    filepath,
    JSON.stringify(
      {
        method,
        path,
        headers,
        body,
      },
      null,
      2
    )
  );
  return filename;
}

function toForwardHeaders(
  headers: IncomingMessage["headers"]
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  const hopByHop = new Set([
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
  ]);

  for (const [key, value] of Object.entries(headers)) {
    if (!key || hopByHop.has(key.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      forwarded[key] = value.join(", ");
      continue;
    }
    if (typeof value === "string") {
      forwarded[key] = value;
    }
  }

  return forwarded;
}

async function main(): Promise<void> {
  const { port, provider, mode } = parseArgs(process.argv);

  const { store, hydrate } = createSdkStore({ driver: createSqliteDriver() });
  await hydrate;
  const discoveryAdapter = createDiscoveryAdapterFromStore(store);
  const providerRegistry = createProviderRegistryFromStore(store);
  const storageAdapter = createStorageAdapterFromStore(store);

  console.log("Bootstrapping providers...");
  const modelManager = new ModelManager(discoveryAdapter);
  const providers = await modelManager.bootstrapProviders(false);
  console.log(`Bootstrapped ${providers.length} providers`);
  await modelManager.fetchModels(providers);
  console.log("Provider bootstrap complete.");

  let activeMintUrl: string | null = null;
  let mintUnits: Record<string, "sat" | "msat"> = {};

  const walletAdapter = {
    async getBalances(): Promise<Record<string, number>> {
      const output = await runWalletCommand(["balance"]);
      const balances = parseBalances(output);
      mintUnits = Object.fromEntries(
        Object.keys(balances).map((mintUrl) => [mintUrl, "sat"])
      );
      if (!activeMintUrl) {
        activeMintUrl = Object.keys(balances)[0] || null;
      }
      return balances;
    },
    getMintUnits(): Record<string, "sat" | "msat"> {
      return mintUnits;
    },
    getActiveMintUrl(): string | null {
      return activeMintUrl;
    },
    async sendToken(mintUrl: string, amount: number): Promise<string> {
      try {
        const output = await runWalletCommand([
          "send",
          "cashu",
          String(amount),
          "--mint-url",
          mintUrl,
        ]);
        const token = pickTokenLine(output);
        if (!token) {
          throw new Error("Wallet CLI did not return a token.");
        }
        return token;
      } catch (error) {
        console.log("ERRORE IN WALLEWT ADP", error);
        throw error;
      }
    },
    async receiveToken(token: string): Promise<{
      success: boolean;
      amount: number;
      unit: "sat" | "msat";
      message?: string;
    }> {
      try {
        await runWalletCommand(["receive", "cashu", token]);
        const decoded = getDecodedToken(token);
        const amount = decoded?.proofs?.reduce(
          (sum, proof) => sum + proof.amount,
          0
        );
        const unit = decoded?.unit === "msat" ? "msat" : "sat";
        return { success: true, amount: amount ?? 0, unit };
      } catch (error) {
        console.log("Eerro in receive", error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const message = errorMessage.includes("Failed to fetch mint")
          ? errorMessage
          : undefined;
        return { success: false, amount: 0, unit: "sat", message };
      }
    },
    isUsingNip60(): boolean {
      return false;
    },
  };

  try {
    const mintsOutput = await runWalletCommand(["mints", "list"]);
    const mints = parseMints(mintsOutput);
    activeMintUrl =
      mints.find((mint) => mint.trusted)?.url || mints[0]?.url || null;
  } catch (error) {
    console.error("Failed to read mints from wallet:", error);
  }

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url || "/", `http://${host}`);

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Only POST is supported." }));
        return;
      }

      let requestBody: unknown = {};
      try {
        const bodyText = await readBody(req);
        requestBody = bodyText ? JSON.parse(bodyText) : {};
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Invalid JSON body.",
            details: error instanceof Error ? error.message : String(error),
          })
        );
        return;
      }

      // const savedFilename = await saveRequestBody(
      //   requestBody,
      //   req.headers,
      //   `${url.pathname}${url.search}`,
      //   req.method || "POST"
      // );
      // console.log(`[daemon] Request body saved to: ${savedFilename}`);

      const bodyObj = requestBody as Record<string, unknown>;
      const modelId = typeof bodyObj.model === "string" ? bodyObj.model : "";

      if (!modelId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing required 'model' field." }));
        return;
      }

      const forcedProvider =
        url.searchParams.get("provider") ||
        (req.headers["x-routstr-provider"] as string | undefined) ||
        provider ||
        undefined;
      const forwardedHeaders = toForwardHeaders(req.headers);

      try {
        const response = await routeRequests({
          modelId,
          requestBody,
          path: url.pathname,
          headers: forwardedHeaders,
          forcedProvider,
          debugLevel: "DEBUG",
          mode,
          walletAdapter,
          storageAdapter,
          providerRegistry,
          discoveryAdapter,
          modelManager,
        });

        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });

        if (!response.body) {
          res.end();
          return;
        }

        const nodeReadable = Readable.fromWeb(response.body as any);
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const fail = (err: unknown) => {
            if (settled) return;
            settled = true;
            reject(err);
          };

          res.once("finish", finish);
          res.once("close", finish);
          res.once("error", fail);
          nodeReadable.once("error", fail);

          nodeReadable.pipe(res);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[daemon] Error: ${message}`);

        if (error instanceof InsufficientBalanceError) {
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: message,
              error_type: "insufficient_balance",
              required: error.required,
              available: error.available,
              maxMintBalance: error.maxMintBalance,
              maxMintUrl: error.maxMintUrl,
            })
          );
          return;
        }

        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    }
  );

  server.listen(port, async () => {
    await ensureRequestsDir();
    console.log(`Routstr daemon listening on http://localhost:${port} (mode: ${mode})`);
  });
}

main().catch((error) => {
  console.error("Failed to start Routstr daemon:", error);
  process.exit(1);
});
