import { createSqliteUsageTrackingDriver } from "@routstr/sdk/storage";

async function main(): Promise<void> {
  const driver = createSqliteUsageTrackingDriver();
  const entries = await driver.list({ limit: 20 });

  if (entries.length === 0) {
    console.log("No usage entries found.");
    return;
  }

  console.log(`Last ${entries.length} usage entries:\n`);
  console.table(
    entries.map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      modelId: e.modelId,
      baseUrl: e.baseUrl,
      cost: e.cost.toFixed(6),
      satsCost: e.satsCost,
      promptTokens: e.promptTokens,
      completionTokens: e.completionTokens,
      totalTokens: e.totalTokens,
      client: e.client ?? "-",
      sessionId: e.sessionId ?? "-",
    }))
  );
}

main().catch((error) => {
  console.error("Failed to list usage entries:", error);
  process.exit(1);
});
