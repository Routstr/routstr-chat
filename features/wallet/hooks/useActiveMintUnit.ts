import { useMemo } from "react";
import { useCashuStore } from "../state/cashuStore";

// keysets come back from storage with their fields as _active and _unit
type StoredKeyset = {
  active?: boolean;
  unit?: string;
  _active?: boolean;
  _unit?: string;
};

/** The unit the wallet counts in at the account's active mint: msat when the
 *  mint offers it, else sat, as the wallet book opens it. */
export function useActiveMintUnit(): string {
  const { mints, activeMintUrl } = useCashuStore();
  return useMemo(() => {
    const keysets = (mints.find((m) => m.url === activeMintUrl)?.keysets ??
      []) as unknown as StoredKeyset[];
    const units = keysets
      .filter((k) => k.active ?? k._active)
      .map((k) => k.unit ?? k._unit);
    return units.includes("msat") ? "msat" : "sat";
  }, [mints, activeMintUrl]);
}
