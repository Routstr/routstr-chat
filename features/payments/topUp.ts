/* What a send takes from the wallet, by the SDK's own sizes (@routstr/sdk
   RoutstrClient._spendToken and _topUpIfNeeded). The SDK exports none of
   these numbers, so topUp.test drives that code and fails if they change. */

// a key is kept at this many times what one message may cost
const MARGIN = 1.4;
// the smallest refill, as a share of what one message may cost
const MIN_REFILL = 0.21;
// a new key never starts below this many sats
const MIN_FIRST_DEPOSIT = 7;

export interface TopUp {
  /** Sats paid before the request goes; it cannot go without them. */
  now: number;
  /** Sats a refill takes in the background; the request goes even if it fails. */
  later: number;
}

/** What a send takes from the wallet when one message may cost `need` sats
 *  and this account's key at the provider holds `credit` sats it can spend
 *  (null: no key there yet). With X-Cashu each message carries its own token. */
export function topUpFor(
  need: number,
  credit: number | null,
  mode: "apikeys" | "xcashu" = "apikeys"
): TopUp {
  if (mode === "xcashu") return { now: Math.ceil(need), later: 0 };
  if (credit === null) {
    return {
      now: Math.max(Math.ceil(need * MARGIN), MIN_FIRST_DEPOSIT),
      later: 0,
    };
  }
  if (credit >= need * MARGIN) return { now: 0, later: 0 };
  const refill = Math.ceil(Math.max(need * MARGIN - credit, MIN_REFILL * need));
  return credit < need ? { now: refill, later: 0 } : { now: 0, later: refill };
}
