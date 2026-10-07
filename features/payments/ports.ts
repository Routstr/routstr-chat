import type { fetchAIResponse } from "@routstr/sdk";
import type { RoutstrClient } from "@routstr/sdk/client";
import type {
  ApiKeyEntry,
  StorageAdapter,
  WalletAdapter,
} from "@routstr/sdk/wallet";
import type { RunCallbacks } from "@/features/chat/run";

export type PaySource = "direct" | "node";

/** One account's provider credit (the keys service). */
export interface Keys {
  ready(): Promise<void>;
  storage(source?: PaySource): StorageAdapter;
  /** This account's payment lock, shared by every tab. */
  lock(signal?: AbortSignal): Promise<() => void>;
  reload(source?: PaySource): Promise<void>;
  flush(source?: PaySource): Promise<void>;
}

/** One account's wallet, built for that account and no other (the wallet
 *  layer, through the wallet book). Every amount is in sats, whatever unit a
 *  mint keeps its coins in. */
export interface Purse {
  /** Spendable sats per mint url. */
  balances(): Promise<Record<string, number>>;
  activeMint(): string;
  /** A fresh token from this account's coins at the mint. It stays this
   *  account's until `handoff` (the SDK storing it) resolves. */
  send(
    mintUrl: string,
    sats: number,
    handoff?: (token: string) => Promise<void>
  ): Promise<string>;
  /** Takes a token into this account's wallet. Resolved, the wallet owns it:
   *  received, or `pending` in its book while the mint cannot be reached, and
   *  taken in by a retry. Throws only when the mint refuses it (spent,
   *  invalid); then nothing is kept. */
  take(token: string): Promise<{ sats: number; pending: boolean }>;
  /** Receives a token only if its mint takes it now; resolves with its sats.
   *  Otherwise it keeps nothing and throws an error with a `reason`. */
  redeem(token: string): Promise<number>;
}

/** Why `redeem` kept nothing. "spent" also covers a token it took already,
 *  before a reload. */
export type RedeemFailure = "unreachable" | "spent" | "refused";

/** Where a request is paid from. */
export interface Spending {
  /** The person's choice; API keys unless they picked X-Cashu. */
  mode: "apikeys" | "xcashu";
  /** A remote routstrd node that pays instead of the wallet. */
  node?: { url: string; apiKey: string };
}

/** Main's credit from before payments were per account, shared by every
 *  account on this device (the keys service). */
export interface OldCredit {
  /** Loaded from disk, without the key of the node that pays now. */
  load(): Promise<StorageAdapter>;
  /** Device-wide, so one account sweeps it at a time. */
  lock(): Promise<() => void>;
}

/** Takes over what a provider holds for a token it spent, as a key of this
 *  account (keys' adopt). Resolves with the sats the key holds, 0 when the
 *  provider says the token was spent elsewhere; throws when it does not
 *  answer, so the token is kept and asked about again. */
export type Adopt = (token: string, baseUrl: string) => Promise<number>;

/** This account's keys that its other devices made (the relay backup). */
export interface OtherDevices {
  keys(): ApiKeyEntry[];
  /** Forget keys once they are refunded. */
  drop(keys: string[]): Promise<void>;
}

type FetchOptions = Parameters<typeof fetchAIResponse>[0];

/** The Routstr SDK, bound to this tab's routing state (discovery cache,
 *  usage log). */
export interface Sdk {
  /** One request through the SDK's routing and payment; resolves once the
   *  payment is settled. */
  request(
    options: Omit<
      FetchOptions,
      "discoveryAdapter" | "usageTrackingDriver" | "sdkStore"
    >,
    callbacks: RunCallbacks
  ): Promise<void>;
  client(wallet: WalletAdapter, storage: StorageAdapter): RoutstrClient;
  /** The shared managers once their cache holds models, so the SDK routes
   *  from it instead of discovering first; undefined on a cold start. */
  warm(): Pick<FetchOptions, "modelManager" | "providerManager"> | undefined;
  /** A settled request's cost in sats, from the usage log. */
  cost(requestId: string): Promise<number | undefined>;
  /** Makes sure the node's models are cached: node mode routes only from it. */
  ensureNode(url: string): Promise<void>;
  torMode(): boolean;
}
