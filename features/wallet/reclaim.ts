import type { UnclaimedToken } from "@/features/book/tokens";

/** How a Reclaim ended. back: the token came back to the wallet. waiting:
 *  it is the wallet's, waiting for its mint. key: the provider it was handed
 *  to made a key from it, which now holds `sats`. spent: someone took it. */
export type Reclaimed =
  | { kind: "back" | "waiting" | "key"; sats: number }
  | { kind: "spent" };

const SPENT = /already spent|already claimed|already redeemed/i;

/**
 * Takes a listed token back. A token the mint says is spent and that was
 * handed to a provider is asked of that provider first (`adopt`): one that
 * made a key from it keeps the money there, and only its "spent elsewhere"
 * (0) means it is gone. Throws when nothing is settled: the token stays
 * listed, for a later try.
 */
export async function reclaim(
  entry: Pick<UnclaimedToken, "token" | "baseUrl">,
  {
    take,
    adopt,
  }: {
    take: (token: string) => Promise<{ sats: number; pending: boolean }>;
    adopt?: (token: string, baseUrl: string) => Promise<number>;
  }
): Promise<Reclaimed> {
  try {
    const { sats, pending } = await take(entry.token);
    return { kind: pending ? "waiting" : "back", sats };
  } catch (error) {
    if (!SPENT.test(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
    if (!entry.baseUrl || !adopt) return { kind: "spent" };
    const sats = await adopt(entry.token, entry.baseUrl);
    return sats > 0 ? { kind: "key", sats } : { kind: "spent" };
  }
}
