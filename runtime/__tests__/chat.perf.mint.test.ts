/**
 * How long a reply takes through the pipeline, next to the same request sent
 * straight to the SDK: what the pipeline itself adds before the first token.
 * Prints medians; fails only if the pipeline adds more than 150 ms.
 */
import { describe, expect, it } from "vitest";
import {
  FakeHistory,
  memoryStorage,
  passThroughAttachments,
} from "@/features/chat/__tests__/fakes";
import type { RunSnapshot } from "@/features/chat/run";
import { emptyDevice, fakeKeys } from "@/features/payments/__tests__/fakes";
import { sdkWallet } from "@/features/payments/request";
import { getKit } from "@/tests/kit";
import { createAccountChat } from "../chat";
import { createRouting } from "../routing";
import { kitPurse } from "./kitPurse";

const kit = getKit();
const RUNS = 7;
const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe("pipeline cost", () => {
  it("adds little before the first token", async () => {
    const routing = createRouting({
      node: () => undefined,
      extraProviders: [kit.coreUrl],
    });
    await routing.catalog.refresh();
    const wallet = kitPurse(kit, "alice", kit.env.mintUrl);
    await wallet.fund(500);
    const credit = fakeKeys();
    await credit.keys.ready();
    let mode: "apikeys" | "xcashu" = "apikeys";
    const account = createAccountChat({
      owner: "alice",
      storage: memoryStorage(),
      history: new FakeHistory(),
      attachments: passThroughAttachments(),
      keys: credit.keys,
      purse: wallet.purse,
      sdk: routing.payments,
      spending: () => ({ mode }),
      ...emptyDevice(),
    });
    const model = { id: "kit-cheap", provider: kit.coreUrl };
    const text = "[kit:chunk=20] [kit:text=one two three four five]";

    // the first reply makes the key; time the ones after it
    await (
      await account.chat.send("warm", text, model)
    ).settled;

    const pipeline = {
      saved: [] as number[],
      first: [] as number[],
      done: [] as number[],
      settled: [] as number[],
    };
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const turn = await account.chat.send(`c${i}`, text, model);
      pipeline.saved.push(performance.now() - t0);
      let first = 0;
      const unsubscribe = turn.run.subscribe(() => {
        const s: RunSnapshot = turn.run.getSnapshot();
        if (!first && s.text) first = performance.now() - t0;
      });
      await turn.reply;
      pipeline.done.push(performance.now() - t0);
      await turn.settled;
      pipeline.settled.push(performance.now() - t0);
      pipeline.first.push(first);
      unsubscribe();
      expect(turn.run.getSnapshot().phase).toBe("done");
    }

    const direct: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      let first = 0;
      await routing.payments.request(
        {
          messageHistory: [{ role: "user", content: text }],
          modelId: model.id,
          forcedProvider: kit.coreUrl,
          mode: "apikeys",
          walletAdapter: sdkWallet(wallet.purse, () => true, false),
          storageAdapter: credit.keys.storage(),
          ...routing.payments.warm(),
        },
        {
          onStreamingUpdate: (t) => {
            if (!first && t) first = performance.now() - t0;
          },
          onThinkingUpdate: () => {},
          onMessageAppend: () => {},
        }
      );
      expect(first).toBeGreaterThan(0);
      direct.push(first);
    }

    // X-Cashu, which v2 offers only as a fallback: core sends the reply whole
    mode = "xcashu";
    const slow = "[kit:chunk=100] [kit:text=one two three four five six]";
    const xcashu = { first: [] as number[], done: [] as number[] };
    const apikey = { first: [] as number[], done: [] as number[] };
    for (const [paying, times] of [
      ["xcashu", xcashu],
      ["apikeys", apikey],
    ] as const) {
      mode = paying;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const turn = await account.chat.send(`${paying}${i}`, slow, model);
        let first = 0;
        const unsubscribe = turn.run.subscribe(() => {
          if (!first && turn.run.getSnapshot().text)
            first = performance.now() - t0;
        });
        await turn.reply;
        times.done.push(performance.now() - t0);
        times.first.push(first);
        unsubscribe();
        await turn.settled;
        expect(turn.run.getSnapshot().phase).toBe("done");
      }
    }

    const ms = (x: number) => `${x.toFixed(1)} ms`;
    console.log(
      [
        `question saved   ${ms(median(pipeline.saved))}`,
        `first token      ${ms(median(pipeline.first))}  (SDK alone ${ms(median(direct))})`,
        `answer saved     ${ms(median(pipeline.done))}`,
        `payment settled  ${ms(median(pipeline.settled))}`,
        `a 0.6 s reply, first token: API key ${ms(median(apikey.first))}, X-Cashu ${ms(median(xcashu.first))} (answer done ${ms(median(apikey.done))} / ${ms(median(xcashu.done))})`,
      ].join("\n")
    );
    expect(Math.min(...pipeline.first)).toBeGreaterThan(0);
    expect(median(pipeline.first) - median(direct)).toBeLessThan(150);
    account.dispose();
  });
});
