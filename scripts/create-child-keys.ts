import { createSdkStore, createSqliteDriver } from "@routstr/sdk/storage";
import {
  createDiscoveryAdapterFromStore,
  createStorageAdapterFromStore,
} from "@routstr/sdk/storage";
import { ModelManager } from "@routstr/sdk";

async function createChildKeys(
  baseUrl: string,
  parentApiKey: string,
  count: number
): Promise<
  Array<{
    childKey: string;
    balance: number;
    balanceLimit?: number;
    validityDate?: number;
  }>
> {
  const response = await fetch(`${baseUrl}v1/balance/child-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${parentApiKey}`,
    },
    body: JSON.stringify({ count }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create child keys: ${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();
  const keys = data.keys || [data.key];
  return keys.map((key: string, index: number) => ({
    childKey: key,
    balance: data.balances?.[index] ?? data.balance ?? 0,
    balanceLimit: data.balance_limits?.[index] ?? data.balance_limit,
    validityDate: data.validity_dates?.[index] ?? data.validity_date,
  }));
}

async function main(): Promise<void> {
  const { store, hydrate } = createSdkStore({ driver: createSqliteDriver() });
  await hydrate;
  const discoveryAdapter = createDiscoveryAdapterFromStore(store);
  const storageAdapter = createStorageAdapterFromStore(store);

  const modelManager = new ModelManager(discoveryAdapter);
  const providers = await modelManager.bootstrapProviders(false);
  await modelManager.fetchModels(providers);

  const uniqueProviders = Array.from(new Set(providers)).sort();
  console.log(`Found ${uniqueProviders.length} providers`);

  let processed = 0;
  let childKeysCreated = 0;

  for (const baseUrl of uniqueProviders) {
    const apiKey = storageAdapter.getApiKey(baseUrl);
    if (!apiKey) {
      console.log(`Skipping ${baseUrl} - no API key configured`);
      continue;
    }

    processed++;

    try {
      const childKeys = await createChildKeys(baseUrl, apiKey.key, 5);

      for (const childKeyData of childKeys) {
        storageAdapter.setChildKey(
          baseUrl,
          childKeyData.childKey,
          childKeyData.balance,
          childKeyData.validityDate,
          childKeyData.balanceLimit
        );
        childKeysCreated++;
      }

      console.log(
        `Created 5 child keys for ${baseUrl} (balance: ${childKeys[0]?.balance ?? 0})`
      );
    } catch (error) {
      console.error(
        `Failed to create child keys for ${baseUrl}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log(`\nDone! Processed ${processed} providers with API keys.`);
  console.log(`Created ${childKeysCreated} child keys total.`);
}

main().catch((error) => {
  console.error("Failed to create child keys:", error);
  process.exit(1);
});
