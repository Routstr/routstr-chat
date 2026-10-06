// What a test uses to drive the local stack: real coins and invoices from the FakeWallet
// mints, the mint's own view of coins, and the fake upstream and relay controls. Works from
// any process (vitest worker, Playwright, a script), given the stack's KitEnv.
import {
  Mint,
  Wallet,
  getEncodedTokenV4,
  getTokenMetadata,
  type Proof,
  type ProofState,
} from "@cashu/cashu-ts";
import type { Event as NostrEvent } from "nostr-tools";
import type { KitEnv } from "./stack";
import type { Behaviour, UpstreamRequest } from "./services/upstream";

const post = async (url: string, body?: unknown) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};
const get = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
};
const http = (ws: string) => ws.replace(/^ws/, "http");

export function kitClient(env: KitEnv) {
  const wallets = new Map<string, Promise<Wallet>>();
  const walletAt = (url: string) => {
    if (!wallets.has(url))
      wallets.set(
        url,
        (async () => {
          const w = new Wallet(new Mint(url), { unit: "sat" });
          await w.loadMint();
          return w;
        })()
      );
    return wallets.get(url)!;
  };

  /** Fresh coins worth `sats`, minted by paying a fake invoice (paid at once). */
  async function mintProofs(
    sats: number,
    mintUrl = env.mintUrl
  ): Promise<Proof[]> {
    const wallet = await walletAt(mintUrl);
    const quote = await wallet.createMintQuote(sats);
    for (
      let i = 0;
      i < 40 && (await wallet.checkMintQuote(quote.quote)).state !== "PAID";
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    return wallet.mintProofs(sats, quote.quote);
  }

  return {
    env,
    get coreUrl(): string {
      if (!env.coreUrl)
        throw new Error("this run has no routstr-core (KIT_CORE_DIR not set)");
      return env.coreUrl;
    },
    mintProofs,
    /** A cashuB token worth `sats` from the kit mint. */
    async mintToken(sats: number, mintUrl = env.mintUrl): Promise<string> {
      return getEncodedTokenV4({
        mint: mintUrl,
        proofs: await mintProofs(sats, mintUrl),
        unit: "sat",
      });
    },
    /** A fake Lightning invoice for `sats` from the second mint (pay it from the first). */
    async invoice(sats: number): Promise<string> {
      return (await (await walletAt(env.invoiceMintUrl)).createMintQuote(sats))
        .request;
    },
    /** The mint's own answer for each coin: UNSPENT, PENDING or SPENT. */
    async coinStates(
      proofs: Pick<Proof, "secret">[],
      mintUrl = env.mintUrl
    ): Promise<ProofState["state"][]> {
      return (await (await walletAt(mintUrl)).checkProofsStates(proofs)).map(
        (s) => s.state
      );
    },
    /** What a token is worth, without needing its mint's keysets. */
    tokenSats: (token: string) => getTokenMetadata(token).amount,
    /** The mint's answer for each coin in a token. */
    async tokenStates(token: string): Promise<ProofState["state"][]> {
      const meta = getTokenMetadata(token);
      return (
        await (
          await walletAt(meta.mint)
        ).checkProofsStates(meta.incompleteProofs)
      ).map((s) => s.state);
    },
    walletAt,
    upstream: {
      queue: (...behaviours: Behaviour[]) =>
        post(`${env.upstreamUrl}/_kit/queue`, behaviours),
      requests: () =>
        get<UpstreamRequest[]>(`${env.upstreamUrl}/_kit/requests`),
      reset: () => post(`${env.upstreamUrl}/_kit/reset`),
    },
    relay: {
      events: (store = "default") =>
        get<NostrEvent[]>(
          `${http(env.relayUrl)}/_kit/events?store=${encodeURIComponent(store)}`
        ),
      seed: (events: NostrEvent[], store = "default") =>
        post(
          `${http(env.relayUrl)}/_kit/seed?store=${encodeURIComponent(store)}`,
          events
        ),
      reset: (store = "default") =>
        post(
          `${http(env.relayUrl)}/_kit/reset?store=${encodeURIComponent(store)}`
        ),
      down: (on: boolean, store = "default") =>
        post(
          `${http(env.relayUrl)}/_kit/down?store=${encodeURIComponent(store)}&on=${on ? 1 : 0}`
        ),
      eoseDelay: (ms: number, store = "default") =>
        post(
          `${http(env.relayUrl)}/_kit/eose-delay?store=${encodeURIComponent(store)}&ms=${ms}`
        ),
    },
  };
}

export type KitClient = ReturnType<typeof kitClient>;
