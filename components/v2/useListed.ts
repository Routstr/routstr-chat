import { useMemo } from "react";
import { useCatalogModels, useCatalogService } from "@/features/catalog/view";

/** What the nodes' listings say across all of them, read again whenever the
 *  model lists change: each model's picture-token price, and its room. */
export function useListed() {
  const catalog = useCatalogService();
  const { models } = useCatalogModels();
  // a new list is new listings to read
  return useMemo(
    () => ({
      pictureRates: (models && catalog?.pictureRates()) || {},
      rooms: (models && catalog?.rooms()) || {},
    }),
    [catalog, models]
  );
}
