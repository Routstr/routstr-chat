import { Mint, Wallet, type Proof } from "@cashu/cashu-ts";
import { walletLock } from "@/features/book/executor";
import { normalizeMintUrl } from "@/features/book/mint";
import type { CoinStore } from "./ports";

// a mint that has not answered by then is asked again on the next sweep
const CHECK_MS = 10_000;

/** The store coins are swept into: it remembers every secret it ever held. */
export interface SweepInto extends Pick<CoinStore, "change"> {
  /** The secrets among these that this device has ever held, for any owner. */
  known(secrets: string[]): Promise<Set<string>>;
}

/** Which of these coins the mint says are unspent (NUT-07). */
export type UnspentCheck = (
  mintUrl: string,
  coins: Proof[]
) => Promise<Proof[]>;

export const unspentAt: UnspentCheck = async (mintUrl, coins) =>
  (await new Wallet(new Mint(mintUrl)).groupProofsByState(coins)).unspent;

type OldKeyset = { id?: string; _id?: string };

/** The coins an old wallet blob lists (main's `cashu:<pubkey>`, or the plain
 *  `cashu`), by mint. A coin whose keyset no listed mint has is left out. */
export function oldCoins(saved: string | null): Map<string, Proof[]> {
  const byMint = new Map<string, Proof[]>();
  let state: {
    proofs?: Proof[];
    mints?: { url?: string; keysets?: OldKeyset[] }[];
  };
  try {
    state = JSON.parse(saved ?? "null")?.state ?? {};
  } catch {
    return byMint;
  }
  const mints = (state.mints ?? []).flatMap((m) =>
    m.url
      ? [
          {
            url: normalizeMintUrl(m.url),
            ids: (m.keysets ?? []).flatMap((k) => k.id ?? k._id ?? []),
          },
        ]
      : []
  );
  for (const proof of state.proofs ?? []) {
    if (!proof?.secret || !proof.id) continue;
    // a token can carry a keyset's short id
    const mint = mints.find((m) =>
      m.ids.some((id) => id === proof.id || id.startsWith(proof.id))
    );
    if (!mint) continue;
    byMint.set(mint.url, [...(byMint.get(mint.url) ?? []), proof]);
  }
  return byMint;
}

/**
 * Brings an old blob's coins into the new store, one way and once each: a
 * coin whose secret the store has ever held, for any account, never comes
 * back (an old tab still writing its list cannot bring back a spent coin),
 * and of the rest only what the mint says is unspent comes in. Each mint is
 * done under the owner's wallet lock, from what the store knows to the
 * change, so no send runs in between. Resolves with the coins brought in.
 */
export async function sweep(
  owner: string,
  coins: Map<string, Proof[]>,
  {
    into,
    locks,
    unspent = unspentAt,
    wait = CHECK_MS,
  }: {
    into: SweepInto;
    locks: LockManager;
    unspent?: UnspentCheck;
    wait?: number;
  }
): Promise<number> {
  let brought = 0;
  for (const [mintUrl, proofs] of coins) {
    await locks
      .request(walletLock(owner), async () => {
        const known = await into.known(proofs.map((p) => p.secret));
        const fresh = proofs.filter((p) => !known.has(p.secret));
        if (!fresh.length) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const good = await Promise.race([
          unspent(mintUrl, fresh),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${mintUrl} did not answer in time`)),
              wait
            );
          }),
        ]).finally(() => clearTimeout(timer));
        if (!good.length) return;
        await into.change(owner, mintUrl, good, []);
        brought += good.length;
      })
      .catch((error) =>
        console.error(`Could not bring ${mintUrl}'s old coins in yet:`, error)
      );
  }
  return brought;
}
