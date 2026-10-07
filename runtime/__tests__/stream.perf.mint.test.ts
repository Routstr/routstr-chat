/**
 * What a long streamed answer costs the engine: the real SDK and core, a
 * markdown reply of about 4,000 words sent one word per chunk, as fast as the
 * kit upstream can. Frames run at 60 Hz, as a browser's would. Prints a
 * baseline for the in-app hunt. Fails only on a gross regression, so a busy
 * machine does not fail it: the thread blocked for 250 ms, the time per chunk
 * growing with the answer, or watchers told of every chunk.
 */
import { describe, expect, it } from "vitest";
import {
  FakeHistory,
  memoryStorage,
  passThroughAttachments,
} from "@/features/chat/__tests__/fakes";
import { emptyDevice, fakeKeys } from "@/features/payments/__tests__/fakes";
import type { Sdk } from "@/features/payments/ports";
import { getKit } from "@/tests/kit";
import { createAccountChat } from "../chat";
import { createRouting } from "../routing";

const kit = getKit();

/** A long answer with the markdown a model writes: headings, lists, code,
 *  tables and links. */
function longAnswer(sections: number): string {
  const part = (i: number) =>
    [
      `## Part ${i}: blind signatures, again`,
      "",
      `A mint signs a point it never sees. See [the spec](https://example.com/nut/${i}) for **why** that matters, and _how_ the wallet strips the factor off.`,
      "",
      "- the wallet picks a secret",
      "- it blinds it with `r`",
      "- the mint signs the blinded point",
      "",
      "```python",
      "Y = hash_to_curve(secret)",
      "B_ = Y + r * G",
      "C = C_ - r * K",
      "```",
      "",
      "| Step | Who sees what |",
      "|---|---|",
      "| Blinding | only you know `r` |",
      "| Signing | the mint sees `B_` |",
      "",
    ].join("\n");
  return Array.from({ length: sections }, (_, i) => part(i + 1)).join("\n");
}

const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(xs.length * p))
  ];
const round = (n: number) => Math.round(n * 100) / 100;

describe("streaming cost", () => {
  it("keeps up with a long markdown answer without blocking", async () => {
    // a browser's frames: the run tells its watchers once per frame
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number;
    let ticker: ReturnType<typeof setInterval> | undefined;
    try {
      const { payments, catalog } = createRouting({
        node: () => undefined,
        extraProviders: [kit.coreUrl],
      });
      await catalog.refresh();
      const credit = fakeKeys();
      await credit.keys.ready();
      const res = await fetch(`${kit.coreUrl}v1/wallet/info`, {
        headers: { Authorization: `Bearer ${await kit.mintToken(400)}` },
      });
      credit.keys.storage().setApiKey(kit.coreUrl, (await res.json()).api_key);

      // the time the SDK's own chunk handling and ours take, per chunk
      const between: number[] = [];
      const inside: number[] = [];
      let last = 0;
      const timed: Sdk = {
        ...payments,
        request: (options, callbacks) =>
          payments.request(options, {
            ...callbacks,
            onStreamingUpdate: (text) => {
              const t = performance.now();
              if (last) between.push(t - last);
              callbacks.onStreamingUpdate(text);
              inside.push(performance.now() - t);
              last = performance.now();
            },
          }),
      };
      const account = createAccountChat({
        owner: "alice",
        storage: memoryStorage(),
        history: new FakeHistory(),
        attachments: passThroughAttachments(),
        keys: credit.keys,
        purse: {
          balances: async () => ({}),
          activeMint: () => kit.env.mintUrl,
          send: async () => {
            throw new Error("the key pays");
          },
          take: async () => ({ sats: 0, pending: false }),
          redeem: async () => 0,
        },
        sdk: timed,
        spending: () => ({ mode: "apikeys" }),
        ...emptyDevice(),
      });

      const text = longAnswer(60);
      await kit.upstream.queue({
        text,
        usage: { prompt: 10, completion: 200 },
      });
      // the thread is blocked when a 5 ms timer fires late
      const blocks: number[] = [];
      let tick = performance.now();
      ticker = setInterval(() => {
        const now = performance.now();
        if (now - tick > 5) blocks.push(now - tick - 5);
        tick = now;
      }, 5);
      const cpu = process.cpuUsage();
      const t0 = performance.now();
      const turn = await account.chat.send("c", "explain, at length", {
        id: "kit-cheap",
        provider: kit.coreUrl,
      });
      let notified = 0;
      turn.run.subscribe(() => notified++);
      const reply = await turn.reply;
      const ms = performance.now() - t0;
      const used = process.cpuUsage(cpu);
      clearInterval(ticker);
      await turn.settled;

      const chunks = inside.length;
      const tenth = Math.floor(between.length / 10);
      const result = {
        words: text.split(/(?<= )/).length,
        chars: text.length,
        chunks,
        streamMs: round(ms),
        chunksPerSecond: Math.round(chunks / (ms / 1000)),
        cpuMsPerChunk: round((used.user + used.system) / 1000 / chunks),
        oursPerChunkMs: {
          p50: round(percentile(inside, 0.5)),
          max: round(Math.max(...inside)),
        },
        gapMs: {
          p50: round(percentile(between, 0.5)),
          firstTenthP50: round(percentile(between.slice(0, tenth), 0.5)),
          lastTenthP50: round(percentile(between.slice(-tenth), 0.5)),
        },
        notifiedFrames: notified,
        blockedOver50ms: blocks.filter((b) => b > 50).length,
        longestBlockMs: round(Math.max(0, ...blocks)),
      };
      console.log(`STREAM_COST ${JSON.stringify(result)}`);

      expect(reply?.content).toBe(text);
      expect(result.longestBlockMs).toBeLessThan(250);
      expect(result.gapMs.lastTenthP50).toBeLessThan(
        result.gapMs.firstTenthP50 * 3 + 1
      );
      // one notification per frame at most, never one per chunk
      expect(notified).toBeLessThan(chunks / 4);
    } finally {
      clearInterval(ticker);
      globalThis.requestAnimationFrame = raf;
    }
  }, 120_000);
});
