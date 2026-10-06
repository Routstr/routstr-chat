import { CatalogService } from "@/features/catalog/service";
import type { Sdk } from "@/features/payments/ports";
import { createSdk } from "@/platform/sdk";

/** Providers, models and the SDK pieces payments use, once per tab. */
export function createRouting(options: {
  /** The remote routstrd node that pays, if any. */
  node(): string | undefined;
  /** Providers to add to discovery, for local test stacks. */
  extraProviders: string[];
}) {
  const sdk = createSdk(options);
  const catalog = new CatalogService({ ...sdk, node: options.node });
  const payments: Sdk = {
    request: sdk.request,
    client: sdk.client,
    cost: sdk.cost,
    warm: () => catalog.warm(),
    ensureNode: (url) => catalog.ensureNode(url),
    torMode: sdk.torMode,
  };
  return { catalog, payments };
}
