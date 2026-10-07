import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeHistory,
  memoryStorage,
  passThroughAttachments,
} from "@/features/chat/__tests__/fakes";
import {
  emptyDevice,
  fakeKeys,
  fakePurse,
  fakeSdk,
  MINT,
  tokenOf,
} from "@/features/payments/__tests__/fakes";
import type { Sdk, Spending } from "@/features/payments/ports";
import type { ApiKeyEntry } from "@routstr/sdk/wallet";
import { createAccountChat } from "../chat";

type RequestArgs = Parameters<Sdk["request"]>;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const MINUTE = 60_000;
const model = { id: "m" };

/** An account's chat over a provider the test drives through the real
 *  payment path (lock, wallet binding, SDK call). */
async function setup(spending: () => Spending = () => ({ mode: "apikeys" })) {
  const credit = fakeKeys();
  await credit.keys.ready();
  const wallet = fakePurse();
  const calls: Array<{ args: RequestArgs; finish(): void }> = [];
  const sdk = fakeSdk(
    vi.fn(
      (...args: RequestArgs) =>
        new Promise<void>((finish) => calls.push({ args, finish }))
    )
  );
  const history = new FakeHistory();
  const account = createAccountChat({
    owner: "alice",
    storage: memoryStorage(),
    history,
    attachments: passThroughAttachments(),
    keys: credit.keys,
    purse: wallet.purse,
    sdk,
    spending,
    ...emptyDevice(),
  });
  /** Credit at a provider, last used long ago, so an automatic refund takes it. */
  const holdOld = (name: string) => {
    credit.keys.storage().setApiKey(`https://${name}.example/`, `sk-${name}`);
    const { store } = credit.stores.direct;
    store.setState({
      apiKeys: store.getState().apiKeys.map((key) => ({ ...key, lastUsed: 0 })),
    });
  };
  return { account, calls, credit, wallet, history, holdOld };
}

// a provider holding 120 sats on every key, paying them out on refund
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("v1/wallet/refund")
        ? new Response(JSON.stringify({ token: tokenOf(120), sats: "120" }))
        : new Response(JSON.stringify({ balance: 120_000, reserved: 0 }))
    )
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createAccountChat", () => {
  it("pays a reply's refund into the account that started it after a switch", async () => {
    const { account, calls, wallet } = await setup();
    const turn = await account.chat.send("c", "hello", model);
    await tick();
    const sdkPays = calls[0].args[0].walletAdapter!;

    // the person switches to another account mid-reply
    account.dispose();

    await expect(sdkPays.sendToken(MINT, 7)).rejects.toMatchObject({
      name: "AbortError",
    });
    await sdkPays.receiveToken(tokenOf(4));
    calls[0].finish();
    await turn.settled;

    expect(wallet.sent).toEqual([]);
    expect(wallet.received).toEqual([tokenOf(4)]);
    expect(turn.run.getSnapshot().phase).toBe("stopped");
  });

  it("stops spending for a reply still settling when the account is put away", async () => {
    const { account, calls, wallet } = await setup();
    const turn = await account.chat.send("c", "hello", model);
    await tick();
    calls[0].args[1].onMessageAppend({ role: "assistant", content: "hi" });
    await turn.reply;
    const sdkPays = calls[0].args[0].walletAdapter!;

    account.dispose();

    await expect(sdkPays.sendToken(MINT, 7)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(wallet.sent).toEqual([]);
    calls[0].finish();
  });

  it("does not count idle time while a reply is being paid for", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { account, calls, wallet, holdOld } = await setup();
    const turn = await account.chat.send("c", "hello", model);
    await vi.advanceTimersByTimeAsync(0);
    holdOld("idle");

    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(wallet.received).toEqual([]);

    calls[0].args[1].onMessageAppend({ role: "assistant", content: "hi" });
    calls[0].finish();
    await turn.settled;
    await turn.reply;
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(wallet.received).toEqual([tokenOf(120)]);
    account.dispose();
  });

  it("refund waits for the reply being paid for, then takes everything", async () => {
    const { account, calls, credit, wallet } = await setup();
    const turn = await account.chat.send("c", "hello", model);
    await tick();
    credit.keys.storage().setApiKey("https://p.example/", "sk-p");

    let refunded = false;
    const refund = account.refund().then(() => (refunded = true));
    await tick();
    expect(refunded).toBe(false);

    calls[0].args[1].onMessageAppend({ role: "assistant", content: "hi" });
    calls[0].finish();
    await turn.settled;
    await refund;
    expect(credit.keys.storage().getAllApiKeys()).toEqual([]);
    expect(wallet.received).toEqual([tokenOf(120)]);
  });

  it("refunds automatically on open and on leaving a chat, and stops when put away", async () => {
    const { account, credit, wallet, holdOld } = await setup();
    holdOld("open");
    await vi.waitFor(() => expect(wallet.received).toHaveLength(1));

    account.viewing("a");
    holdOld("left");
    account.viewing("b");
    await vi.waitFor(() => expect(wallet.received).toHaveLength(2));

    // a put-away account no longer takes the account's payment lock
    account.dispose();
    holdOld("away");
    const locks = credit.keys.lock.mock.calls.length;
    account.viewing("c");
    await tick();
    await tick();
    expect(credit.keys.lock.mock.calls.length).toBe(locks);
    expect(wallet.received).toHaveLength(2);
  });

  it("names what each provider's key spends first, the same object until it changes, and no keys when X-Cashu or a node pays", async () => {
    let spending: Spending = { mode: "apikeys" };
    const { account, credit } = await setup(() => spending);
    expect(account.held.keys()).toEqual({});

    const storage = credit.keys.storage();
    storage.setApiKey("https://a.example/", "sk-a");
    storage.updateApiKeyBalance("https://a.example/", 30);
    const held = account.held.keys();
    expect(held).toEqual({ "https://a.example/": 30 });
    expect(account.held.keys()).toBe(held);
    storage.updateApiKeyBalance("https://a.example/", 25);
    expect(account.held.keys()).toEqual({ "https://a.example/": 25 });

    spending = { mode: "xcashu" };
    expect(account.held.keys()).toBeNull();
    spending = { mode: "apikeys", node: { url: "https://node.example/", apiKey: "sk-n" } };
    expect(account.held.keys()).toBeNull();
    account.dispose();
  });
});

describe("held", () => {
  it("counts the keys the account's other devices backed up, and follows them", async () => {
    const credit = fakeKeys();
    await credit.keys.ready();
    let others: ApiKeyEntry[] = [];
    const listeners = new Set<() => void>();
    const account = createAccountChat({
      owner: "alice",
      storage: memoryStorage(),
      history: new FakeHistory(),
      attachments: passThroughAttachments(),
      keys: credit.keys,
      purse: fakePurse().purse,
      sdk: fakeSdk(),
      spending: () => ({ mode: "apikeys" }),
      ...emptyDevice(),
      otherDevices: {
        keys: () => others,
        drop: async () => {},
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
    await tick();
    let told = 0;
    account.held.subscribe(() => told++);
    expect(account.held.get()).toBe(0);

    // a closed device's keys arrive from the relays: one read, one never answered
    others = [
      { baseUrl: "https://a.example/", key: "sk-a", balance: 80, lastUsed: 0 },
      { baseUrl: "https://b.example/", key: tokenOf(77), balance: 0, lastUsed: 0 },
    ];
    listeners.forEach((listener) => listener());

    expect(told).toBe(1);
    expect(account.held.get()).toBe(157);
    account.dispose();
  });
});
