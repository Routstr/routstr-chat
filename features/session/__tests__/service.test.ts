import { describe, expect, it } from "vitest";
import { PrivateKeyAccount } from "applesauce-accounts/accounts";
import { SessionService, type AccountMetadata } from "../service";

const memory = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

const key = () => PrivateKeyAccount.generateNew<AccountMetadata>();

describe("SessionService", () => {
  it("restores the saved accounts and the active one at boot", () => {
    const first = new SessionService();
    const storage = memory();
    first.boot(storage);
    const alice = key();
    const bob = key();
    first.add(alice, "Alice");
    first.add(bob);
    first.switchTo(alice.id);

    const next = new SessionService();
    next.boot(memory(Object.fromEntries(storage.data)));
    expect(next.accounts.accounts$.value.map((a) => a.pubkey)).toEqual([
      alice.pubkey,
      bob.pubkey,
    ]);
    expect(next.accounts.accounts$.value[0].metadata).toEqual({
      name: "Alice",
    });
    expect(next.getSnapshot()).toMatchObject({
      accountId: alice.id,
      pubkey: alice.pubkey,
    });
  });

  it("tells its listeners before anything else that watches the active account", () => {
    const session = new SessionService();
    session.boot(memory());
    const order: string[] = [];
    session.subscribe(() =>
      order.push(`session ${session.getSnapshot().pubkey}`)
    );
    session.accounts.active$.subscribe((a) =>
      order.push(`app ${a?.pubkey ?? null}`)
    );
    order.length = 0;

    const alice = key();
    session.add(alice);
    expect(order).toEqual([`session ${alice.pubkey}`, `app ${alice.pubkey}`]);
  });
});
