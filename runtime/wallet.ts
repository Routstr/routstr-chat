import {
  legacyActivity,
  legacyCoins,
} from "@/features/wallet/hooks/purseBridge";
import { createPurse, type Purse } from "@/features/wallet/purse";
import { journal, locks } from "./book";

/* The one door to each account's money, for chat and keys. */

const purses = new Map<string, Purse>();

/** The purse of `owner`, never of whoever is active when it is used. */
export function purseFor(owner: string): Purse {
  let purse = purses.get(owner);
  if (!purse) {
    purse = createPurse(owner, {
      coins: legacyCoins,
      activity: legacyActivity,
      journal,
      locks,
    });
    purses.set(owner, purse);
  }
  return purse;
}
