import { getTokenMetadata } from "@cashu/cashu-ts";

/** What a token is worth in sats, whatever unit its mint keeps; 0 when it
 *  cannot be read. */
export function tokenSats(token: string): number {
  try {
    const { unit, amount } = getTokenMetadata(token);
    return unit === "msat" ? amount / 1000 : amount;
  } catch {
    return 0;
  }
}
