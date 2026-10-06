import { describe, expect, it } from "vitest";
import { BehaviorSubject } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import type { AccountMetadata } from "@/features/session/service";
import { relayBackupPorts } from "../relayBackup";
import { KEY_BACKUP_D, parseBackup, type SyncedApiKey } from "../backup";
import type { Remote } from "../relayBackup";

const keys: SyncedApiKey[] = [
  {
    device: "d1",
    baseUrl: "https://p.test/",
    key: "sk-1",
    balance: 9,
    lastUsed: null,
  },
];

const setup = (ready: Promise<void> = Promise.resolve()) => {
  const account = PrivateKeyAccount.generateNew<AccountMetadata>();
  const latest = new BehaviorSubject<{
    event: NostrEvent | null;
    settled: boolean;
  }>({
    event: null,
    settled: false,
  });
  const published: NostrEvent[] = [];
  const ports = relayBackupPorts(
    {
      ready: () => ready,
      watchLatest: () => latest,
      publish: async (event) => (published.push(event), ["wss://local"]),
    },
    account,
    KEY_BACKUP_D,
    parseBackup
  );
  const heard: Remote<SyncedApiKey[]>[] = [];
  ports.watch((remote) => heard.push(remote));
  const flush = () => new Promise((r) => setTimeout(r, 20));
  return { account, latest, published, ports, heard, flush };
};

describe("relayBackupPorts", () => {
  it("publishes main's event (kind 30078, its d tag, encrypted to self) and reads it back", async () => {
    const t = setup();
    await t.ports.publish(keys);
    const [event] = t.published;
    expect(event.kind).toBe(30078);
    expect(event.tags).toEqual([["d", "routstr-chat-sdk-api-keys-v1"]]);
    expect(event.content).not.toContain("sk-1");

    // a copy from the first relay to answer waits until every relay has
    t.latest.next({ event, settled: false });
    await t.flush();
    expect(t.heard).toEqual([]);
    t.latest.next({ event, settled: true });
    await t.flush();
    expect(t.heard).toEqual([keys]);
  });

  it("says none only once every relay answered, and unreadable for a foreign or broken copy", async () => {
    const t = setup();
    await t.flush();
    expect(t.heard).toEqual([]);
    t.latest.next({ event: null, settled: true });
    await t.flush();
    expect(t.heard).toEqual(["none"]);

    const other = PrivateKeyAccount.generateNew();
    const foreign = await other.signEvent({
      kind: 30078,
      tags: [["d", "routstr-chat-sdk-api-keys-v1"]],
      content: await other.nip44!.encrypt(other.pubkey, JSON.stringify(keys)),
      created_at: 1,
    });
    t.latest.next({ event: foreign, settled: true });
    await t.flush();
    const broken = await t.account.signEvent({
      kind: 30078,
      tags: [["d", "routstr-chat-sdk-api-keys-v1"]],
      content: "not encrypted",
      created_at: 2,
    });
    t.latest.next({ event: broken, settled: true });
    await t.flush();
    const [real] = (await t.ports.publish(keys), t.published);
    const forged = { ...real, id: "f".repeat(64), created_at: 3 };
    t.latest.next({ event: forged, settled: true });
    await t.flush();
    expect(t.heard).toEqual(["none", "unreadable", "unreadable", "unreadable"]);
  });

  it("drops a copy whose decrypt finishes after a newer copy arrived", async () => {
    const real = PrivateKeyAccount.generateNew<AccountMetadata>();
    // a remote signer that answers the first decrypt late
    let release: () => void = () => {};
    const late = new Promise<void>((r) => (release = r));
    let calls = 0;
    const slow = {
      pubkey: real.pubkey,
      signEvent: real.signEvent.bind(real),
      nip44: {
        encrypt: real.nip44!.encrypt.bind(real.nip44),
        decrypt: async (pk: string, content: string) => {
          if (calls++ === 0) await late;
          return real.nip44!.decrypt(pk, content);
        },
      },
    } as unknown as typeof real;
    const latest = new BehaviorSubject<{
      event: NostrEvent | null;
      settled: boolean;
    }>({ event: null, settled: false });
    const ports = relayBackupPorts(
      {
        ready: async () => {},
        watchLatest: () => latest,
        publish: async () => [],
      },
      slow,
      KEY_BACKUP_D,
      parseBackup
    );
    const heard: Remote<SyncedApiKey[]>[] = [];
    ports.watch((remote) => heard.push(remote));
    const copy = async (key: string, at: number) =>
      real.signEvent({
        kind: 30078,
        tags: [["d", KEY_BACKUP_D]],
        content: await real.nip44!.encrypt(
          real.pubkey,
          JSON.stringify([{ ...keys[0], key }])
        ),
        created_at: at,
      });
    const older = await copy("sk-older", 1);
    const newer = await copy("sk-newer", 2);

    latest.next({ event: older, settled: true });
    latest.next({ event: newer, settled: true });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await new Promise((r) => setTimeout(r, 20));

    expect(heard.map((r) => (r as SyncedApiKey[])[0].key)).toEqual([
      "sk-newer",
    ]);
  });

  it("reads nothing until the account's own relays are known", async () => {
    let known: () => void = () => {};
    const t = setup(new Promise((r) => (known = r)));
    t.latest.next({ event: null, settled: true });
    await t.flush();
    expect(t.heard).toEqual([]);
    known();
    await t.flush();
    expect(t.heard).toEqual(["none"]);
  });

  it("gives each copy a later second than the one before", async () => {
    const t = setup();
    await t.ports.publish(keys);
    await t.ports.publish(keys);
    const [first, second] = t.published;
    expect(second.created_at).toBeGreaterThan(first.created_at);
  });
});
