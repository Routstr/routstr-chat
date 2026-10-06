import { createContext, useCallback, useContext } from "react";
import { currentOwner } from "@/features/session/owned";
import type { Purse } from "./purse";

export { peek } from "./purse";

/** Each account's purse, filled by the composition root (runtime/wallet's
 *  purseFor). Without it screens have no purse and money buttons do nothing. */
export const PurseContext = createContext<((owner: string) => Purse) | null>(
  null
);

/** The purse of the account active when it is called: a key made a moment
 *  ago (the first money in) is the one paid into. Null with no account. A
 *  purse is one account's for good, so what it began settles there. */
export function usePurse(): () => Purse | null {
  const purseFor = useContext(PurseContext);
  return useCallback(() => {
    const owner = currentOwner();
    return owner && purseFor ? purseFor(owner) : null;
  }, [purseFor]);
}
