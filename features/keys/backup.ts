import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ApiKeyEntry } from "@routstr/sdk/wallet";
import type { KeysService } from "./service";
import type { BackupPorts, Remote } from "./relayBackup";

/* Backs up an account's provider keys on its relays, encrypted to itself, and
   restores the ones this device lost. Same event as main: kind 30078,
   d "routstr-chat-sdk-api-keys-v1", content = every device's keys. Relay I/O,
   signing and NIP-44 sit behind `BackupPorts`; this file only decides. */

export const KEY_BACKUP_D = "routstr-chat-sdk-api-keys-v1";

/** A provider key and the device that holds it as its active key. */
export type SyncedApiKey = ApiKeyEntry & { device: string };

/** The keys this account's other devices backed up, for the chat's refund
 *  (chat.md `otherDevices`). Drop a key only once its refund is in the wallet:
 *  until then it stays in the backup, so a crash in between loses nothing. */
export interface OtherDevices {
  keys(): SyncedApiKey[];
  drop(keys: string[]): Promise<void>;
  /** What the provider says one of those keys holds now, in sats. */
  checked(key: string, sats: number): void;
  /** Runs when those keys change. */
  subscribe(listener: () => void): () => void;
}

const isEntry = (value: unknown): value is SyncedApiKey => {
  const e = value as Record<string, unknown> | null;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.device === "string" &&
    typeof e.baseUrl === "string" &&
    typeof e.key === "string" &&
    typeof e.balance === "number" &&
    (e.lastUsed === null || typeof e.lastUsed === "number")
  );
};

/** The decrypted content, or "unreadable". */
export const parseBackup = (content: unknown): SyncedApiKey[] | "unreadable" =>
  Array.isArray(content) && content.every(isEntry) ? content : "unreadable";

// a failed backup is tried again on the next change
const report = (error: unknown) => console.error("[keys backup]", error);

/** The keys that left this device while the relays may still list them, by
 *  hash, kept across reloads. */
export interface Removed {
  read(): string[];
  write(hashes: string[]): void;
}

const inMemory = (): Removed => {
  let kept: string[] = [];
  return { read: () => kept, write: (hashes) => void (kept = hashes) };
};

const hashOf = (key: string) => bytesToHex(sha256(utf8ToBytes(key)));

const keySet = (keys: SyncedApiKey[]) =>
  keys
    .map((k) => `${k.device} ${k.baseUrl} ${k.key}`)
    .sort()
    .join("\n");

export class KeyBackup {
  // the set last seen on the relays; null until they answered with something readable
  private published: string | null = null;
  private others: SyncedApiKey[] = [];
  // keys that left this device; the relays may still list them
  private readonly removed: Set<string>;
  // what providers said lately that the other devices' keys hold: the backup
  // keeps a key's balance of when the key set last changed, since a balance
  // alone is never published (each reply would ask the signer)
  private readonly balances = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly keys: KeysService,
    private readonly device: string,
    private readonly ports: BackupPorts<SyncedApiKey[]>,
    private readonly delayMs = 500,
    private readonly saved: Removed = inMemory()
  ) {
    this.removed = new Set(saved.read());
  }

  /** Runs until the returned stop is called (the account's lifetime). */
  start(): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = this.keys.keys();
    const stopLocal = this.keys.subscribe(() => {
      const now = this.keys.keys();
      const kept = new Set(now.map((k) => k.key));
      const left = last.filter((k) => !kept.has(k.key));
      left.forEach((k) => this.removed.add(hashOf(k.key)));
      if (left.length) this.saved.write([...this.removed]);
      last = now;
      clearTimeout(timer);
      timer = setTimeout(() => this.publish().catch(report), this.delayMs);
    });
    const stopRemote = this.ports.watch((remote) =>
      this.apply(remote).catch(report)
    );
    return () => {
      stopLocal();
      stopRemote();
      clearTimeout(timer);
    };
  }

  /** Keys other devices of this account hold (refund can recover them),
   *  each with what its provider said it holds once asked. */
  otherKeys(): SyncedApiKey[] {
    return this.others.map((k) =>
      this.balances.has(k.key)
        ? { ...k, balance: this.balances.get(k.key)! }
        : k
    );
  }

  /** What a provider says one of those keys holds now. */
  checkedOther(key: string, sats: number): void {
    if (this.balances.get(key) === sats) return;
    this.balances.set(key, sats);
    this.listeners.forEach((listener) => listener());
  }

  /** Runs when the other devices' keys change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** After refunding other devices' keys, they leave the backup. */
  async dropOthers(keys: string[]): Promise<void> {
    const gone = new Set(keys);
    this.others = this.others.filter((k) => !gone.has(k.key));
    this.listeners.forEach((listener) => listener());
    await this.publish();
  }

  async apply(remote: Remote<SyncedApiKey[]>): Promise<void> {
    // nothing is published over a copy that cannot be read
    if (remote === "unreadable") return void (this.published = null);
    const listed = remote === "none" ? [] : remote;
    const release = await this.keys.lock();
    try {
      // a request in another tab writes the whole list: restore on fresh state
      await this.keys.reload();
      const storage = this.keys.storage();
      for (const key of listed) {
        if (key.device !== this.device || this.removed.has(hashOf(key.key)))
          continue;
        // another key at that provider replaced it
        if (storage.getApiKey(key.baseUrl)) continue;
        storage.setApiKey(key.baseUrl, key.key);
        storage.updateApiKeyBalance(key.baseUrl, key.balance);
      }
      await this.keys.flush();
    } finally {
      release();
    }
    // the relays no longer list a key that left: nothing is left to skip
    if (remote !== "none") {
      const onRelays = new Set(listed.map((k) => hashOf(k.key)));
      const caughtUp = [...this.removed].filter((hash) => !onRelays.has(hash));
      caughtUp.forEach((hash) => this.removed.delete(hash));
      if (caughtUp.length) this.saved.write([...this.removed]);
    }
    this.published = keySet(listed);
    this.others = listed.filter((k) => k.device !== this.device);
    this.listeners.forEach((listener) => listener());
    await this.publish();
  }

  private async publish(): Promise<void> {
    if (this.published === null) return;
    const keys = [
      ...this.others,
      ...this.keys.keys().map((k) => ({ ...k, device: this.device })),
    ];
    if (keySet(keys) === this.published) return;
    await this.ports.publish(keys);
    this.published = keySet(keys);
  }
}
