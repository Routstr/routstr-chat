import { Mint, Wallet, type Proof } from "@cashu/cashu-ts";
import { walletLock } from "@/features/book/executor";
import type { CoinStore } from "./ports";

// a mint that has not answered by then is asked again on the next load
const CHECK_MS = 10_000;

/** Which of these coins the mint says are spent (NUT-07). */
export type SpentCheck = (mintUrl: string, coins: Proof[]) => Promise<Proof[]>;

export const askMint: SpentCheck = async (mintUrl, coins) =>
  (await new Wallet(new Mint(mintUrl)).groupProofsByState(coins)).spent;

/**
 * Takes out this owner's coins at the mint that the mint says are spent, and
 * resolves with them. The mint is asked outside the wallet lock and given
 * `wait` ms, so a slow mint never holds up a payment; only taking the coins
 * out holds the lock, and only coins still in the store go. Pending and
 * unspent coins stay.
 */
export async function dropSpent(
  owner: string,
  mintUrl: string,
  {
    coins,
    check = askMint,
    locks,
    wait = CHECK_MS,
  }: { coins: CoinStore; check?: SpentCheck; locks: LockManager; wait?: number }
): Promise<Proof[]> {
  const held = await coins.coins(owner, mintUrl);
  if (!held.length) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const spent = await Promise.race([
    check(mintUrl, held),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${mintUrl} did not answer in time`)),
        wait
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (!spent.length) return [];
  return locks.request(walletLock(owner), async () => {
    const now = new Set((await coins.coins(owner, mintUrl)).map((c) => c.secret));
    const gone = spent.filter((c) => now.has(c.secret));
    if (gone.length) await coins.change(owner, mintUrl, [], gone);
    return gone;
  });
}
