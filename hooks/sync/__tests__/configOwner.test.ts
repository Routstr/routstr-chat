import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, Subject } from "rxjs";
import type { NostrEvent } from "nostr-tools";

const sync = vi.hoisted(() => ({
  events: new Map<string, unknown>(),
}));

vi.mock("../genericConfigSync", () => ({
  configSyncEose$: new BehaviorSubject(true),
  configEventReceived$: new Subject(),
  decryptEventContent: vi.fn(),
  getConfigEvent: (_kind: number, pubkey: string) => sync.events.get(pubkey),
}));

import { configOwner, createConfigObservable } from "../configObservables";
import { userPubkey$, userSigner$ } from "../chatSyncInputs";
import type { UserSignerInfo } from "../chatSyncInputs";

const copyOf = (pubkey: string, ids: string[]) =>
  ({
    id: `${pubkey}-copy`,
    pubkey,
    content: JSON.stringify(ids),
  }) as unknown as NostrEvent;

describe("createConfigObservable", () => {
  it("tells which account each replayed copy was read for, even when two are equal", () => {
    sync.events.set("alice", copyOf("alice", ["same"]));
    sync.events.set("bob", copyOf("bob", ["same"]));
    const lists$ = createConfigObservable<string[]>({
      id: "test",
      kind: 30078,
      dTag: "test",
      encrypted: false,
      parseContent: (data) => (Array.isArray(data) ? data : null),
      defaultValue: [],
    });
    const signer = { nip44: { encrypt: vi.fn(), decrypt: vi.fn() } };
    userSigner$.next({
      signer: { ...signer, signEvent: vi.fn() },
      pubkey: "alice",
    } as UserSignerInfo);
    userPubkey$.next("alice");
    const seen: string[][] = [];
    const sub = lists$.subscribe((list) => seen.push(list));

    userPubkey$.next("bob");
    sub.unsubscribe();

    expect(seen).toEqual([["same"], ["same"]]);
    expect(seen.map(configOwner)).toEqual(["alice", "bob"]);
  });
});
