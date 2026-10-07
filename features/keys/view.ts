import { createContext, useContext, useSyncExternalStore } from "react";
import { useSession } from "@/features/session/view";
import { useCatalogService } from "@/features/catalog/view";
import { exportedKeysFor, type ExportedKey, type Purse } from "./exported";

export type { ExportedKey };

/** The composition root fills this with the wallet's `purseFor`. Without it
 *  keys can be listed and refreshed, but no money moves. */
export const PurseContext = createContext<((owner: string) => Purse) | null>(
  null
);

const NONE: ExportedKey[] = [];
const quiet = () => () => {};

/** The active account's exported keys, the service that changes them, and
 *  its purse (null until the composition root provides one). */
export function useExportedKeys() {
  const { pubkey } = useSession();
  const purseFor = useContext(PurseContext);
  const service = pubkey ? exportedKeysFor(pubkey) : null;
  const keys = useSyncExternalStore(
    service ? service.subscribe : quiet,
    () => service?.list() ?? NONE,
    () => NONE
  );
  const purse = service && purseFor ? purseFor(service.owner) : null;
  return { service, keys, purse };
}

/** Providers a key can be made at, as the catalogue last found them. */
export const useKnownProviders = (): string[] =>
  useCatalogService()?.knownProviders() ?? [];
