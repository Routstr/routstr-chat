/**
 * The chat pipeline with real money: real routstr-core in front of the kit's
 * fake upstream, a real FakeWallet mint, the real SDK and the real wallet book.
 * Stand-ins: history (in memory), the coin store (in memory, through the
 * book's commit) and the keys service (the real SDK store in memory, one tab:
 * reload does nothing and the lock is not a Web Lock). Two-tab cases live in
 * the unit tests. Wallet checks end on the mint's coin states.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTokenMetadata } from "@cashu/cashu-ts";
import {
  FakeHistory,
  memoryStorage,
  passThroughAttachments,
} from "@/features/chat/__tests__/fakes";
import { emptyDevice, fakeKeys } from "@/features/payments/__tests__/fakes";
import type { Spending } from "@/features/payments/ports";
import { getKit } from "@/tests/kit";
import { createAccountChat } from "../chat";
import { createRouting } from "../routing";
import { kitPurse } from "./kitPurse";

const kit = getKit();

let spending: Spending;
let routing: ReturnType<typeof createRouting>;

beforeEach(async () => {
  spending = { mode: "apikeys" };
  routing = createRouting({
    node: () => undefined,
    extraProviders: [kit.coreUrl],
  });
  await routing.catalog.refresh();
  await kit.upstream.reset();
});

async function account(owner = "alice", sats = 300) {
  const wallet = kitPurse(kit, owner, kit.env.mintUrl);
  await wallet.fund(sats);
  const credit = fakeKeys();
  await credit.keys.ready();
  const history = new FakeHistory();
  // a session of this account: the first, or a later one after a switch back
  const session = () =>
    createAccountChat({
      owner,
      storage: memoryStorage(),
      history,
      attachments: passThroughAttachments(),
      keys: credit.keys,
      purse: wallet.purse,
      sdk: routing.payments,
      spending: () => spending,
      ...emptyDevice(),
    });
  return { chat: session(), session, wallet, credit, history };
}

const model = () => ({ id: "kit-cheap", provider: kit.coreUrl });

/** Nothing the account owns is lost: its coins are all good at the mint and
 *  nothing is stuck in the wallet book. */
async function settledAndUnspent(wallet: ReturnType<typeof kitPurse>) {
  expect(await kit.coinStates(wallet.coins)).toEqual(
    wallet.coins.map(() => "UNSPENT")
  );
  expect(
    wallet.journal.list(wallet.owner).filter((r) => r.kind !== "token")
  ).toEqual([]);
}

describe("chat with real money", () => {
  it("lists core's models through discovery", () => {
    expect(routing.catalog.getSnapshot().models.map((m) => m.id)).toContain(
      "kit-cheap"
    );
  });

  it("pays with an API key, saves the answer, and refunds what is left", async () => {
    const { chat, wallet, credit, history } = await account();

    const turn = await chat.chat.send("c", "hello", model());
    const reply = await turn.reply;
    await turn.settled;

    expect(turn.run.getSnapshot()).toMatchObject({ phase: "done" });
    expect(
      turn.run.getSnapshot().error ?? turn.run.getSnapshot().warning
    ).toBeUndefined();
    expect(reply?.content).toBe("Echo: hello");
    expect(history.branch("c").map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
    const key = credit.keys.storage().getAllApiKeys()[0];
    expect(key.baseUrl).toBe(kit.coreUrl);
    await vi.waitFor(() =>
      expect(chat.costs.getSnapshot()[reply!._eventId]).toBeGreaterThan(0)
    );
    const afterDeposit = wallet.sats;
    expect(afterDeposit).toBeLessThan(300);

    await chat.refund();

    expect(credit.keys.storage().getAllApiKeys()).toEqual([]);
    expect(wallet.sats).toBeGreaterThan(afterDeposit);
    // the reply cost under a sat; a refund pays whole sats
    expect(wallet.sats).toBeGreaterThanOrEqual(298);
    await settledAndUnspent(wallet);
    chat.dispose();
  });

  it("reuses the key for the next reply without touching the wallet", async () => {
    const { chat, wallet } = await account();
    await (
      await chat.chat.send("c", "one", model())
    ).settled;
    const afterFirst = wallet.sats;

    const second = await chat.chat.send("c", "two", model());
    await second.settled;

    expect(second.run.getSnapshot().phase).toBe("done");
    expect(wallet.sats).toBe(afterFirst);
    chat.dispose();
  });

  it("pays each reply with X-Cashu when chosen and keeps the change", async () => {
    spending = { mode: "xcashu" };
    const { chat, wallet, credit } = await account();

    const turn = await chat.chat.send("c", "hello", model());
    await turn.settled;

    expect(turn.run.getSnapshot().phase).toBe("done");
    expect(credit.keys.storage().getAllApiKeys()).toEqual([]);
    // core charges X-Cashu in whole sats
    expect(wallet.sats).toBeGreaterThanOrEqual(299);
    await settledAndUnspent(wallet);
    chat.dispose();
  });

  for (const mode of ["apikeys", "xcashu"] as const) {
    it(`keeps a reply's reasoning, live and saved (${mode})`, async () => {
      spending = { mode };
      const { chat, history } = await account();
      const thoughts: string[] = [];

      const turn = await chat.chat.send("c", "why? [kit:think]", model());
      turn.run.subscribe(() => thoughts.push(turn.run.getSnapshot().thinking));
      const reply = await turn.reply;
      await turn.settled;

      // X-Cashu arrives whole from core, but its reasoning still shows
      expect(thoughts.some((t) => t.includes("Thinking about it."))).toBe(true);
      expect(reply?.content).toEqual([
        expect.objectContaining({
          type: "text",
          thinking: expect.stringContaining("Thinking about it."),
        }),
      ]);
      expect(history.branch("c")[1].content).toEqual(reply?.content);
      chat.dispose();
    });
  }

  it.each(["apikeys", "xcashu"] as const)(
    "never pays a provider that is turned off, and pays it again once it is back on (%s)",
    async (mode) => {
      spending = { mode };
      const { chat, session, wallet } = await account();
      const unpinned = { id: "kit-cheap" };

      routing.catalog.setProviderOn(kit.coreUrl, false);
      try {
        expect(routing.catalog.routes("kit-cheap")).toEqual([]);
        const turn = await chat.chat.send("c", "hello", unpinned);
        await turn.settled;

        expect(turn.run.getSnapshot().phase).toBe("failed");
        expect(await kit.upstream.requests()).toEqual([]);
        expect(wallet.sats).toBe(300);
      } finally {
        routing.catalog.setProviderOn(kit.coreUrl, true);
        chat.dispose();
      }

      // back on: the next start trusts the test stack's provider again, and pays it
      routing = createRouting({
        node: () => undefined,
        extraProviders: [kit.coreUrl],
      });
      await routing.catalog.refresh();
      const next = session();
      const turn = await next.chat.send("c", "again", unpinned);
      await turn.settled;
      expect(turn.run.getSnapshot().phase).toBe("done");
      expect(wallet.sats).toBeLessThan(300);
      next.dispose();
    }
  );

  it("loses nothing when the provider fails before answering", async () => {
    const { chat, wallet } = await account();

    const turn = await chat.chat.send("c", "boom [kit:fail=500]", model());
    await turn.settled;
    await chat.refund();

    expect(turn.run.getSnapshot().phase).toBe("failed");
    expect(await turn.reply).toBeUndefined();
    expect(wallet.sats).toBe(300);
    await settledAndUnspent(wallet);
    chat.dispose();
  });

  it("keeps what arrived at Stop, and the rest comes back", async () => {
    const { chat, wallet } = await account();

    const turn = await chat.chat.send(
      "c",
      "go [kit:chunk=300] [kit:text=one two three four five six]",
      model()
    );
    await vi.waitFor(() => expect(turn.run.getSnapshot().text).not.toBe(""), {
      timeout: 20_000,
    });
    chat.chat.stop("c");
    const reply = await turn.reply;
    await turn.settled;
    await chat.refund();

    expect(turn.run.getSnapshot().phase).toBe("stopped");
    expect(reply?.content).toEqual(expect.stringMatching(/\S/));
    expect(wallet.sats).toBeGreaterThanOrEqual(298);
    await settledAndUnspent(wallet);
    chat.dispose();
  });

  it("can be stopped from the moment of send with X-Cashu too, and the rest comes back", async () => {
    spending = { mode: "xcashu" };
    const { chat, wallet, credit } = await account();

    const sending = chat.chat.send("c", "go [kit:slow=3000]", model());
    // the composer shows Stop at once, before anything streams
    expect(chat.chat.asking("c")).toBe(true);
    const turn = await sending;
    await vi.waitFor(
      async () => expect(await kit.upstream.requests()).toHaveLength(1),
      { timeout: 20_000 }
    );
    chat.chat.stop("c");
    await turn.reply;
    expect(chat.chat.asking("c")).toBe(false);
    await turn.settled;
    // core holds the token until its own call upstream ends, then gives it back
    await vi.waitFor(
      async () => {
        await chat.refund();
        expect(wallet.sats).toBeGreaterThanOrEqual(298);
      },
      { timeout: 20_000, interval: 1000 }
    );

    expect(turn.run.getSnapshot().phase).toBe("stopped");
    expect(credit.keys.storage().getXcashuTokens()).toEqual({});
    await settledAndUnspent(wallet);
    chat.dispose();
  });

  it("shows a key stopped as its token was made as held, and a refund brings all of it back", async () => {
    const { chat, wallet } = await account();
    const send = wallet.purse.send;
    // Stop lands the moment the top-up token exists, before the provider answered
    wallet.purse.send = async (mint, sats, handoff) => {
      const token = await send(mint, sats, handoff);
      chat.chat.stop("c");
      return token;
    };
    const turn = await chat.chat.send("c", "go [kit:slow=3000]", model());
    await turn.reply;
    await turn.settled;

    expect(turn.run.getSnapshot().phase).toBe("stopped");
    expect(wallet.sats).toBeLessThan(300);
    expect(chat.held.get()).toBe(300 - wallet.sats);
    await vi.waitFor(
      async () => {
        await chat.refund();
        expect(wallet.sats).toBe(300);
      },
      { timeout: 20_000, interval: 1000 }
    );
    expect(chat.held.get()).toBe(0);
    await settledAndUnspent(wallet);
    chat.dispose();
  });

  it("loses nothing when the account is put away mid-reply", async () => {
    const alice = await account("alice");

    const turn = await alice.chat.chat.send(
      "c",
      "slow [kit:slow=1500]",
      model()
    );
    await vi.waitFor(
      () => expect(alice.credit.keys.storage().getAllApiKeys()).toHaveLength(1),
      { timeout: 20_000 }
    );
    alice.chat.dispose();
    await turn.settled;
    // a put-away account refunds nothing; its next session does
    await expect(alice.chat.refund()).rejects.toThrow(
      "Account or payment source changed"
    );
    const later = alice.session();
    await later.refund();

    expect(turn.run.getSnapshot().phase).toBe("stopped");
    expect(alice.wallet.sats).toBeGreaterThanOrEqual(298);
    await settledAndUnspent(alice.wallet);
    later.dispose();
  });

  it("lets a node pay on a fresh install, never touching the wallet", async () => {
    // a routstrd-style node: one key it already holds credit on
    const info = await fetch(`${kit.coreUrl}v1/wallet/info`, {
      headers: { authorization: `Bearer ${await kit.mintToken(100)}` },
    });
    const { api_key: apiKey } = (await info.json()) as { api_key: string };
    // a fresh discovery cache, as on the first start after moving from main
    routing = createRouting({ node: () => kit.coreUrl, extraProviders: [] });
    spending = { mode: "apikeys", node: { url: kit.coreUrl, apiKey } };
    const { chat, wallet } = await account();

    const turn = await chat.chat.send("c", "hello node", model());
    await turn.settled;

    expect(turn.run.getSnapshot()).toMatchObject({ phase: "done" });
    expect(wallet.sats).toBe(300);
    chat.dispose();
  });

  it("gives up on an X-Cashu refund core keeps pending, and keeps it for later", async () => {
    spending = { mode: "xcashu" };
    const { chat, credit, wallet } = await account();

    const turn = await chat.chat.send(
      "c",
      "[kit:cut=2] one two three four",
      model()
    );
    await turn.settled;
    const started = Date.now();
    await chat.refund();

    expect(Date.now() - started).toBeLessThan(15_000);
    // the token core kept stays listed as a claim for a later refund (its coins
    // are spent at the mint, so this is the claim's face value, not money in hand)
    const held = Object.values(credit.keys.storage().getXcashuTokens())
      .flat()
      .reduce((sum, entry) => sum + getTokenMetadata(entry.token).amount, 0);
    expect(held).toBeGreaterThan(0);
    expect(wallet.sats + held).toBe(300);
    chat.dispose();
  });
});
