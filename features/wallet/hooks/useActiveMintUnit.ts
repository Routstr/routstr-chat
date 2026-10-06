import { useMemo } from "react";
import { calculateBalanceByMint } from "../core/utils/balance";
import { useCashuStore } from "../state/cashuStore";

/** The unit the signed-in account's coins at its active mint count in. */
export function useActiveMintUnit(): string {
  const { proofs, mints, activeMintUrl } = useCashuStore();
  return useMemo(
    () => calculateBalanceByMint(proofs, mints).units[activeMintUrl ?? ""] ?? "sat",
    [proofs, mints, activeMintUrl]
  );
}
