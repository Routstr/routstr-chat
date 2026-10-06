import {
  legacyActivity,
  legacyCoins,
  localActivity,
} from "@/features/wallet/hooks/purseBridge";
import { createPurse, type Purse } from "@/features/wallet/purse";
import type { ActivityLog } from "@/features/wallet/ports";
import { journal, locks } from "./book";

/* The one door to each account's money. A chat's per-reply payments and
   refunds keep their activity on this device (a reply never asks the
   signer); what the person does with a button (the wallet screens, API keys)
   is published. Both kinds move coins through the same book and lock. */

const made = new Map<ActivityLog, Map<string, Purse>>();

function cached(owner: string, activity: ActivityLog): Purse {
  const purses = made.get(activity) ?? new Map<string, Purse>();
  made.set(activity, purses);
  let purse = purses.get(owner);
  if (!purse) {
    purse = createPurse(owner, {
      coins: legacyCoins,
      activity,
      journal,
      locks,
    });
    purses.set(owner, purse);
  }
  return purse;
}

/** The purse a chat pays replies from: of `owner`, never of whoever is
 *  active when it is used. */
export const purseFor = (owner: string): Purse => cached(owner, localActivity);

/** The purse of `owner` for the person's own moves: activity published. */
export const walletPurseFor = (owner: string): Purse =>
  cached(owner, legacyActivity);
