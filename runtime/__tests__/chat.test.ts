import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeHistory, memoryStorage, passThroughAttachments } from "@/features/chat/__tests__/fakes";
import {
  emptyDevice,
  fakeKeys,
  fakePurse,
  fakeSdk,
  MINT,
  tokenOf,
} from "@/features/payments/__tests__/fakes";
import type { Sdk } from "@/features/payments/ports";
import { createAccountChat } from "../chat";

type RequestArgs = Parameters<Sdk["request"]>;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const MINUTE = 60_000;
const model = { id: "m" };

/** An account's chat over a provider the test drives through the real
 *  payment path (lock, wallet binding, SDK call). */
async function setup() {
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
    spending: () => ({ mode: "apikeys" }),
    ...emptyDevice(),
  });
  return { account, calls, credit, wallet, history };
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

    await expect(sdkPays.sendToken(MINT, 7)).rejects.toMatchObject({ name: "AbortError" });
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

    await expect(sdkPays.sendToken(MINT, 7)).rejects.toMatchObject({ name: "AbortError" });
    expect(wallet.sent).toEqual([]);
    calls[0].finish();
  });

  it("does not count idle time while a reply is being paid for", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { account, calls, credit } = await setup();
    const refunds = () => credit.keys.ready.mock.calls.length;
    const turn = await account.chat.send("c", "hello", model);
    await vi.advanceTimersByTimeAsync(0);
    const before = refunds();

    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(refunds()).toBe(before);

    calls[0].args[1].onMessageAppend({ role: "assistant", content: "hi" });
    calls[0].finish();
    await turn.settled;
    await turn.reply;
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(refunds()).toBe(before + 1);
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
    const { account, credit } = await setup();
    await tick();
    // once by the test's own setup, once by the refund on open
    const opened = credit.keys.ready.mock.calls.length;
    expect(opened).toBe(2);

    account.viewing("a");
    account.viewing("b");
    await tick();
    expect(credit.keys.ready.mock.calls.length).toBe(opened + 1);

    account.dispose();
    account.viewing("c");
    await tick();
    expect(credit.keys.ready.mock.calls.length).toBe(opened + 1);
  });
});
