import { createSdkStore, createSqliteDriver } from "@routstr/sdk/storage";
import { createDiscoveryAdapterFromStore } from "@routstr/sdk/storage";
import { ModelManager } from "@routstr/sdk/discovery";

async function fetchRoutstr21Models(): Promise<string[]> {
  const { store, hydrate } = createSdkStore({ driver: createSqliteDriver() });
  await hydrate;
  const discoveryAdapter = createDiscoveryAdapterFromStore(store);

  const modelManager = new ModelManager(discoveryAdapter);
  const providers = await modelManager.bootstrapProviders(false);

  if (providers.length > 0) {
    await modelManager.fetchModels(providers);
  }

  // Direct call ensures models are fetched (bootstrap may timeout)
  await modelManager.fetchRoutstr21Models();

  const models = discoveryAdapter.getRoutstr21Models();
  return models;
}

fetchRoutstr21Models()
  .then((models) => {
    console.log(`\nFound ${models.length} routstr21 models:`);
    models.forEach((model, i) => {
      console.log(`${i + 1}. ${model}`);
    });
  })
  .catch(console.error);
