import { createContext, useContext, useSyncExternalStore } from "react";
import type { CatalogService, CatalogSnapshot } from "./service";

export const CatalogContext = createContext<CatalogService | null>(null);

export const useCatalogService = (): CatalogService | null =>
  useContext(CatalogContext);

const empty: CatalogSnapshot = { models: [], loading: true };
const none = () => () => {};

/** The models providers serve, and whether the first list is still coming. */
export function useCatalogModels(): CatalogSnapshot {
  const catalog = useCatalogService();
  return useSyncExternalStore(
    catalog?.subscribe ?? none,
    () => catalog?.getSnapshot() ?? empty,
    () => empty
  );
}
