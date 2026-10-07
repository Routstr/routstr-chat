import type { StoredInvoice } from "./useInvoiceSync";

// a mint invoice only moves forward
const RANK: Record<string, number> = { UNPAID: 0, PAID: 1, ISSUED: 2 };

/** The state an invoice moves to: a mint invoice's never goes back (a copy
 *  read before its claim says less than one read after); a melt's does, since
 *  a failed payment is UNPAID again. */
export function forward(
  was: Pick<StoredInvoice, "type" | "state">,
  now: Pick<StoredInvoice, "type" | "state">
): StoredInvoice["state"] {
  if (was.type !== "mint") return now.state;
  return (RANK[now.state] ?? 0) >= (RANK[was.state] ?? 0)
    ? now.state
    : was.state;
}

/** Two copies of one invoice (cloud and this device): the one checked later,
 *  its state never behind the other's. */
export function mergeInvoice(
  a: StoredInvoice,
  b: StoredInvoice
): StoredInvoice {
  const [older, newer] =
    (b.checkedAt || 0) > (a.checkedAt || 0) ? [a, b] : [b, a];
  return { ...newer, state: forward(older, newer) };
}
