import { RoutstrClient, WalletAdapter } from "@routstr/sdk";
import { createSdkStore, createSqliteDriver } from "@routstr/sdk/storage";
import {
  createProviderRegistryFromStore,
  createStorageAdapterFromStore,
} from "@routstr/sdk/storage";
import { spawn } from "child_process";
import { getDecodedToken } from "@cashu/cashu-ts";

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

async function main(): Promise<void> {
  const mintUrl = process.argv[2] || "https://mint.minibits.cash/Bitcoin";

  const { store, hydrate } = createSdkStore({ driver: createSqliteDriver() });
  await hydrate;
  const storageAdapter = createStorageAdapterFromStore(store);
  const providerRegistry = createProviderRegistryFromStore(store);

  const cachedReceiveTokens = storageAdapter.getCachedReceiveTokens();
  const apiKeysStored = storageAdapter.getApiKeyDistribution();

  if (cachedReceiveTokens.length === 0 && apiKeysStored.length === 0) {
    console.log("No pending tokens to refund");
    return;
  }

  console.log(`Found ${cachedReceiveTokens.length} cached receive tokens:`);
  for (const pending of cachedReceiveTokens) {
    const tokenPreview = pending.token.substring(0, 20) + "...";
    console.log(`  - ${tokenPreview}: ${pending.amount} sats (${pending.unit})`);
  }

  console.log(`Found ${apiKeysStored.length} apikeys:`);
  for (const apikey of apiKeysStored) {
    console.log(`  - ${apikey.baseUrl}: ${apikey.amount} sats`);
  }

  const refundBaseUrls = apiKeysStored.map((p) => p.baseUrl);

  let mintUnits: Record<string, "sat" | "msat"> = {};

  const walletAdapter: WalletAdapter = {
    async getBalances(): Promise<Record<string, number>> {
      const output = await runWalletCommand(["balance"]);
      const balances = parseBalances(output);
      mintUnits = Object.fromEntries(
        Object.keys(balances).map((mintUrl) => [mintUrl, "sat"])
      );
      return balances;
    },
    getMintUnits(): Record<string, "sat" | "msat"> {
      return mintUnits;
    },
    getActiveMintUrl(): string | null {
      return null;
    },
    async sendToken(mintUrl: string, amount: number): Promise<string> {
      const output = await runWalletCommand([
        "send",
        "cashu",
        String(amount),
        "--mint-url",
        mintUrl,
      ]);
      const lines = output.split("\n");
      const tokenLine = lines.find((line) => line.includes("cashu"));
      if (!tokenLine) {
        throw new Error("Wallet CLI did not return a token.");
      }
      return tokenLine.trim();
    },
    async receiveToken(
      token: string
    ): Promise<{ success: boolean; amount: number; unit: "sat" | "msat" }> {
      await runWalletCommand(["receive", "cashu", token]);
      const decoded = getDecodedToken(token);
      const amount = decoded?.proofs?.reduce(
        (sum, proof) => sum + proof.amount,
        0
      );
      const unit = decoded?.unit === "msat" ? "msat" : "sat";
      return { success: true, amount: amount ?? 0, unit };
    },
  };

  const client = new RoutstrClient(
    walletAdapter,
    storageAdapter,
    providerRegistry,
    "min",
    "apikeys"
  );

  const spender = client.getCashuSpender();

  console.log(`\nRefunding to mint: ${mintUrl}`);

  // Refund API keys (apikeys mode)
  const results = await spender.refundProviders(mintUrl, true);

  console.log("\nRefund results:");
  for (const result of results) {
    console.log(
      `  - ${result.baseUrl}: ${result.success ? "success" : "failed"}`
    );
  }
}

main().catch((error) => {
  console.error("Failed to refund:", error);
  process.exit(1);
});
