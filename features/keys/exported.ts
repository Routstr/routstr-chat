import {
  BalanceManager,
  type StorageAdapter,
  type WalletAdapter,
} from "@routstr/sdk/wallet";
import { owned } from "@/features/session/owned";
import { savedInIndexedDB, type Saved } from "@/features/session/saved";
import type { BackupPorts, Remote } from "./relayBackup";

/* Keys a person makes for other apps: credit at one provider behind an sk-
   key. Same formats as main: the local list `api_keys` (now
   `api_keys:<pubkey>`) and its relay copy, d "routstr-chat-api-keys-v1".
   Coins move only through the key owner's purse. */

export const EXPORTED_BACKUP_D = "routstr-chat-api-keys-v1";

export interface ExportedKey {
  key: string;
  /** msats, as the provider reports; null until first read */
  balance: number | null;
  label?: string;
  baseUrl?: string;
  isInvalid?: boolean;
}

/** The owner's door to the money (wallet.md `purseFor(owner)`). */
export interface Purse {
  activeMint(): string;
  send(
    mint: string,
    sats: number,
    handoff: (token: string) => Promise<void>
  ): Promise<unknown>;
  receive(token: string): Promise<unknown>;
}

/** The two provider calls, as the SDK makes them. */
export type Provider = Pick<
  BalanceManager,
  "getTokenBalance" | "fetchRefundToken"
>;

const slash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

// the wallet waits on the provider inside a handoff, so a provider that never
// answers must not hold it
const inTime = <T>(call: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(
      () => fail(new Error("The provider did not answer.")),
      30_000
    );
  });
  return Promise.race([call, late]).finally(() => clearTimeout(timer));
};

export const parseExported = (json: unknown): ExportedKey[] | "unreadable" =>
  Array.isArray(json) &&
  json.every((k) => typeof k?.key === "string" && k.key.length > 0)
    ? json
    : "unreadable";

export class ExportedKeys {
  private readonly listeners = new Set<() => void>();
  // whether the relays answered with a copy this device could read, and that copy
  private heard = false;
  private remote: ExportedKey[] = [];
  // keys that left this list this session; the relays may still list them
  private readonly removed = new Set<string>();
  private push: () => void = () => {};
  // one snapshot until it changes, so screens can watch it
  private keys: ExportedKey[];
  // the list as kept in IndexedDB, which a main tab's sign-out cannot wipe;
  // null until that copy was read, and nothing is written over it before
  private kept: ExportedKey[] | null = null;
  private readonly name: string;

  constructor(
    readonly owner: string,
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly provider: Provider,
    private readonly saved: Saved
  ) {
    this.name = owned("api_keys", owner);
    this.keys = this.read();
    saved
      .get(this.name)
      .then((json) => {
        const keys = json ? parseExported(JSON.parse(json)) : [];
        this.kept = keys === "unreadable" ? [] : keys;
        this.repair();
      })
      .catch(report);
  }

  list(): ExportedKey[] {
    return this.keys;
  }

  /** Another tab changed the list. */
  reload(): void {
    this.keys = this.read();
    this.listeners.forEach((listener) => listener());
  }

  /** Writes the list back after localStorage was wiped. */
  repair(): void {
    this.change((keys) => keys);
  }

  private read(): ExportedKey[] {
    const saved = this.storage.getItem(this.name);
    const keys = saved ? parseExported(JSON.parse(saved)) : [];
    return keys === "unreadable" ? [] : keys;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Every change starts from what is on disk and in IndexedDB, so a second
   *  tab's key is never written over with this tab's older list, and a wiped
   *  localStorage loses nothing. */
  private change(next: (keys: ExportedKey[]) => ExportedKey[]): ExportedKey[] {
    const disk = this.read();
    const known = new Set(disk.map((k) => k.key));
    const lost = (this.kept ?? []).filter(
      (k) => !known.has(k.key) && !this.removed.has(k.key)
    );
    const keys = next([...disk, ...lost]);
    const json = JSON.stringify(keys);
    this.storage.setItem(this.name, json);
    this.keys = keys;
    this.listeners.forEach((listener) => listener());
    if (this.kept) {
      this.kept = keys;
      this.saved.put(this.name, json).catch(report);
    }
    return keys;
  }

  private update(key: string, change: Partial<ExportedKey>): void {
    this.change((keys) =>
      keys.map((k) => (k.key === key ? { ...k, ...change } : k))
    );
  }

  /** Spends `sats` into a new key. The key is on disk before the token is let
   *  go; if the provider fails, the token stays in the wallet's unclaimed list. */
  async create(purse: Purse, baseUrl: string, sats: number, label: string) {
    let made: ExportedKey | undefined;
    await purse.send(purse.activeMint(), sats, async (token) => {
      const ask = () =>
        inTime(this.provider.getTokenBalance(token, slash(baseUrl)));
      let info = await ask();
      // an answer lost on the way may still have made the key; asked again
      // with the same token, the provider finds that key
      if (info.balanceUnknown && !info.isInvalidApiKey) info = await ask();
      if (info.balanceUnknown || !info.apiKey) {
        throw new Error("The provider did not make a key. Try again later.");
      }
      made = {
        key: info.apiKey,
        balance: info.amount,
        label,
        baseUrl: slash(baseUrl),
      };
      this.change((keys) => [...keys, made!]);
      this.push();
    });
    return made!;
  }

  async refresh(key: ExportedKey): Promise<void> {
    if (!key.baseUrl) return;
    const info = await this.provider.getTokenBalance(key.key, key.baseUrl);
    if (info.isInvalidApiKey) return this.update(key.key, { isInvalid: true });
    if (!info.balanceUnknown) {
      this.update(key.key, { balance: info.amount, isInvalid: false });
    }
  }

  /** The token goes to the provider in the request body, never in a URL. */
  async topUp(purse: Purse, key: ExportedKey, sats: number): Promise<void> {
    if (!key.baseUrl) throw new Error("This key has no provider address.");
    await purse.send(purse.activeMint(), sats, async (token) => {
      const response = await fetch(`${key.baseUrl}v1/wallet/topup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cashu_token: token }),
        // the wallet waits on this, so a hung provider must not hold it
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Top-up failed (${response.status})`);
    });
    await this.refresh(key);
  }

  /** Brings what is left on a key back to the wallet, then forgets it. The
   *  provider decides: a key it does not know, or one with nothing to pay
   *  out, is forgotten; a payout it made before that never landed is paid
   *  again. When that fails the key stays, and only `forget` drops it. */
  async remove(purse: Purse | null, key: ExportedKey): Promise<void> {
    if (!key.baseUrl) throw new Error("This key has no provider address.");
    if (!purse) {
      throw new Error("The wallet is not ready, so no sats can move.");
    }
    const refund = await this.provider.fetchRefundToken(key.baseUrl, key.key);
    if (refund.keyNotFound || refund.noBalance) return this.forget(key.key);
    if (!refund.success || !refund.token) {
      throw new Error(refund.error || "The provider did not refund this key.");
    }
    await purse.receive(refund.token);
    this.forget(key.key);
  }

  forget(key: string): void {
    this.removed.add(key);
    this.change((keys) => keys.filter((k) => k.key !== key));
    this.push();
  }

  /** Keeps the list on the account's relays, for its other devices. */
  start(ports: BackupPorts<ExportedKey[]>): () => void {
    this.heard = false;
    this.push = () =>
      void (this.heard && ports.publish(this.backup()).catch(report));
    const stop = ports.watch((remote) => this.merge(remote));
    return () => {
      stop();
      this.push = () => {};
    };
  }

  /** What goes on the relays: this list and every key they listed that was
   *  not removed here, so a list that lost keys (a wipe of this browser's
   *  storage) never takes them off the relays too. */
  private backup(): ExportedKey[] {
    const here = new Set(this.keys.map((k) => k.key));
    const elsewhere = this.remote.filter(
      (k) => !here.has(k.key) && !this.removed.has(k.key)
    );
    return [...this.keys, ...elsewhere];
  }

  /** Takes in other devices' keys. Publishes only when this device holds a
   *  key the relays lack: a key removed here but kept by another device stays
   *  on the relays, so two devices never answer each other forever. */
  private merge(remote: Remote<ExportedKey[]>): void {
    // nothing is published over a copy that cannot be read
    this.heard = remote !== "unreadable";
    if (remote === "unreadable") return;
    const listed = remote === "none" ? [] : remote;
    this.remote = listed;
    const there = new Set(listed.map((k) => k.key));
    const keys = this.change((local) => {
      const known = new Set(local.map((k) => k.key));
      const added = listed.filter(
        (k) => !known.has(k.key) && !this.removed.has(k.key)
      );
      return added.length ? [...local, ...added] : local;
    });
    if (keys.some((k) => !there.has(k.key))) this.push();
  }
}

// a failed backup is tried again on the next change
const report = (error: unknown) => console.error("[exported keys]", error);

const services = new Map<string, ExportedKeys>();

/** The keys a person made for other apps, one service per account per tab. */
export function exportedKeysFor(owner: string): ExportedKeys {
  let keys = services.get(owner);
  if (!keys) {
    // these two provider calls touch neither the wallet nor the storage
    const provider = new BalanceManager(
      {} as WalletAdapter,
      {} as StorageAdapter
    );
    keys = new ExportedKeys(
      owner,
      window.localStorage,
      provider,
      savedInIndexedDB()
    );
    const name = owned("api_keys", owner);
    const service = keys;
    window.addEventListener("storage", (e) => {
      // a main tab's sign-out clears localStorage: the list goes back in
      if (e.key === null || (e.key === name && !e.newValue)) service.repair();
      else if (e.key === name) service.reload();
    });
    services.set(owner, keys);
  }
  return keys;
}
