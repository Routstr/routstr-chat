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

const keySet = (keys: SyncedApiKey[]) =>
  keys
    .map((k) => `${k.device} ${k.baseUrl} ${k.key}`)
    .sort()
    .join("\n");

export class KeyBackup {
  // the set last seen on the relays; null until they answered with something readable
  private published: string | null = null;
  private others: SyncedApiKey[] = [];
  // keys that left this device this session; the relays may still list them
  private readonly removed = new Set<string>();

  constructor(
    private readonly keys: KeysService,
    private readonly device: string,
    private readonly ports: BackupPorts<SyncedApiKey[]>,
    private readonly delayMs = 500
  ) {}

  /** Runs until the returned stop is called (the account's lifetime). */
  start(): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = this.keys.keys();
    const stopLocal = this.keys.subscribe(() => {
      const now = this.keys.keys();
      const kept = new Set(now.map((k) => k.key));
      last.forEach((k) => kept.has(k.key) || this.removed.add(k.key));
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

  /** Keys other devices of this account hold (refund can recover them). */
  otherKeys(): SyncedApiKey[] {
    return this.others;
  }

  /** After refunding other devices' keys, they leave the backup. */
  async dropOthers(keys: string[]): Promise<void> {
    const gone = new Set(keys);
    this.others = this.others.filter((k) => !gone.has(k.key));
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
        if (key.device !== this.device || this.removed.has(key.key)) continue;
        // another key at that provider replaced it
        if (storage.getApiKey(key.baseUrl)) continue;
        storage.setApiKey(key.baseUrl, key.key);
        storage.updateApiKeyBalance(key.baseUrl, key.balance);
      }
      await this.keys.flush();
    } finally {
      release();
    }
    this.published = keySet(listed);
    this.others = listed.filter((k) => k.device !== this.device);
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
