import type { MeltQuoteResponse } from "@cashu/cashu-ts";

/** What a melt quote asks, in whole sats rounded up: a mint that offers msat
 *  quotes in msat, and the screens count sats. */
export function quoteInSats(
  quote: Pick<MeltQuoteResponse, "amount" | "fee_reserve" | "unit">
) {
  const sats = (n: number) => (quote.unit === "msat" ? Math.ceil(n / 1000) : n);
  return { amount: sats(quote.amount), feeReserve: sats(quote.fee_reserve) };
}
