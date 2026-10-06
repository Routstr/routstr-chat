import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestRun, type Transport } from "../run";

type Callbacks = Parameters<Transport>[0];

/** A transport the test drives by hand, the way the SDK drives the real one. */
function manualTransport() {
  let callbacks!: Callbacks;
  let signal!: AbortSignal;
  let settle!: () => void;
  let reject!: (error: Error) => void;
  const transport = vi.fn<Transport>((cb, abortSignal) => {
    callbacks = cb;
    signal = abortSignal;
    return new Promise<void>((resolve, fail) => {
      settle = resolve;
      reject = fail;
    });
  });
  return {
    transport,
    get cb() {
      return callbacks;
    },
    get signal() {
      return signal;
    },
    settle: () => settle(),
    reject: (error: Error) => reject(error),
  };
}

function startRun() {
  const wire = manualTransport();
  const run = new RequestRun();
  const settled = run.start(wire.transport);
  return { wire, run, settled };
}

// a frame per update, so subscribers see each phase
beforeEach(() =>
  vi.stubGlobal("requestAnimationFrame", (flush: () => void) => flush())
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RequestRun", () => {
  it("walks the phases a paid request really has", () => {
    const { wire, run } = startRun();
    const phases = [run.getSnapshot().phase];
    run.subscribe(() => phases.push(run.getSnapshot().phase));

    // in the SDK's order: "payment over" comes only after the answer
    wire.cb.onPaymentProcessing?.(true);
    wire.cb.onThinkingUpdate("hm");
    wire.cb.onStreamingUpdate("Blind");
    wire.cb.onMessageAppend({
      role: "assistant",
      content: "Blind signatures.",
    });
    wire.cb.onPaymentProcessing?.(false);

    expect(phases).toEqual([
      "preparing",
      "paying",
      "thinking",
      "answering",
      "done",
    ]);
  });

  it("ends when the answer ends, before the payment settles", async () => {
    const { wire, run, settled } = startRun();
    const order: string[] = [];
    void run.ended.then(() => order.push("ended"));
    void settled.then(() => order.push("settled"));

    wire.cb.onStreamingUpdate("Blind signatures.");
    wire.cb.onMessageAppend({
      role: "assistant",
      content: "Blind signatures.",
    });
    wire.cb.onStreamingUpdate("");
    await Promise.resolve();
    expect(order).toEqual(["ended"]);

    wire.settle();
    await settled;
    expect(order).toEqual(["ended", "settled"]);
    expect(run.getSnapshot()).toMatchObject({
      phase: "done",
      text: "Blind signatures.",
      message: { role: "assistant", content: "Blind signatures." },
    });
  });

  it("stops at once and keeps the text that was already paid for", async () => {
    const { wire, run } = startRun();
    wire.cb.onStreamingUpdate("Blind signatures let a mint");

    run.stop();
    // What the SDK does after an abort
    wire.cb.onStreamingUpdate("");
    wire.cb.onMessageAppend({ role: "system", content: "Generation stopped." });

    expect(wire.signal.aborted).toBe(true);
    await run.ended;
    expect(run.getSnapshot()).toMatchObject({
      phase: "stopped",
      text: "Blind signatures let a mint",
      message: { role: "assistant", content: "Blind signatures let a mint" },
    });
    expect(run.getSnapshot().error).toBeUndefined();
  });

  it("leaves a finished answer's payment alone when Stop comes late", () => {
    const { wire, run } = startRun();
    wire.cb.onMessageAppend({ role: "assistant", content: "Done." });

    run.stop();

    expect(wire.signal.aborted).toBe(false);
    expect(run.getSnapshot().phase).toBe("done");
  });

  it("never reaches the transport when stopped before it started", async () => {
    const wire = manualTransport();
    const run = new RequestRun();

    run.stop();
    await run.start(wire.transport);

    expect(wire.transport).not.toHaveBeenCalled();
    expect(run.getSnapshot()).toMatchObject({ phase: "stopped" });
  });

  it("fails with the provider's reason and keeps the partial reply", () => {
    const { wire, run } = startRun();
    wire.cb.onStreamingUpdate("Half an ans");

    wire.cb.onMessageAppend({
      role: "system",
      content: "Uncaught Error: AI stream was cut off",
    });

    expect(run.getSnapshot()).toMatchObject({
      phase: "failed",
      error: "Uncaught Error: AI stream was cut off",
      message: { role: "assistant", content: "Half an ans" },
    });
  });

  it("keeps the text when the SDK clears it before reporting a failure", () => {
    const { wire, run } = startRun();
    wire.cb.onThinkingUpdate("hmm");
    wire.cb.onStreamingUpdate("half an");

    wire.cb.onStreamingUpdate("");
    wire.cb.onThinkingUpdate("");
    wire.cb.onMessageAppend({
      role: "system",
      content: "Uncaught Error: cut off",
    });

    expect(run.getSnapshot()).toMatchObject({
      phase: "failed",
      thinking: "hmm",
      message: {
        content: [{ type: "text", text: "half an", thinking: "hmm" }],
      },
    });
  });

  it("fails when the request breaks before the SDK is reached", async () => {
    const { wire, run, settled } = startRun();

    wire.reject(new Error("wallet is locked"));
    await settled;

    expect(run.getSnapshot()).toMatchObject({
      phase: "failed",
      error: "wallet is locked",
    });
  });

  it("fails when the transport ends without an answer", async () => {
    const { wire, run, settled } = startRun();

    wire.settle();
    await settled;

    await run.ended;
    expect(run.getSnapshot()).toMatchObject({ phase: "failed" });
  });

  it("warns, and keeps the answer, when settling breaks after it", async () => {
    const { wire, run, settled } = startRun();
    wire.cb.onMessageAppend({ role: "assistant", content: "Done." });

    wire.reject(new Error("disk full"));
    await settled;

    expect(run.getSnapshot()).toMatchObject({
      phase: "done",
      message: { content: "Done." },
      warning: expect.stringContaining("disk full"),
    });
  });

  it("still warns when a real failure follows Stop", async () => {
    const { wire, run, settled } = startRun();
    run.stop();

    wire.reject(new Error("disk full"));
    await settled;

    expect(run.getSnapshot()).toMatchObject({
      phase: "stopped",
      warning: expect.stringContaining("disk full"),
    });
  });

  it("stays stopped when the SDK reports paying after Stop", () => {
    const { wire, run } = startRun();
    run.stop();

    // the SDK still says "paying" once routing ends, even after the abort
    wire.cb.onPaymentProcessing?.(true);

    expect(run.getSnapshot().phase).toBe("stopped");
  });

  it("says nothing when the transport rejects only because Stop aborted it", async () => {
    const { wire, run, settled } = startRun();
    run.stop();

    wire.reject(new DOMException("aborted", "AbortError"));
    await settled;

    expect(run.getSnapshot().warning).toBeUndefined();
  });

  it("carries the reasoning the SDK drops from a text-only reply", () => {
    vi.useFakeTimers();
    const { wire, run } = startRun();

    wire.cb.onThinkingUpdate("The user wants BDHKE.");
    vi.advanceTimersByTime(9000);
    wire.cb.onStreamingUpdate("Blind");
    // the answer streaming on does not count as thinking
    vi.advanceTimersByTime(4000);
    wire.cb.onMessageAppend({
      role: "assistant",
      content: "Blind signatures.",
    });

    expect(run.getSnapshot().thinkingMs).toBe(9000);
    expect(run.getSnapshot().message?.content).toEqual([
      {
        type: "text",
        text: "Blind signatures.",
        thinking: "The user wants BDHKE.",
      },
    ]);
  });

  it("takes the usage log key that arrives after the answer has ended", () => {
    const { wire, run } = startRun();
    wire.cb.onMessageAppend({ role: "assistant", content: "Done." });

    wire.cb.onRequestId?.("req-42");

    expect(run.getSnapshot()).toMatchObject({
      phase: "done",
      requestId: "req-42",
    });
  });

  it("tells subscribers once per frame however fast tokens arrive", () => {
    const wire = manualTransport();
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (flush: () => void) =>
      frames.push(flush)
    );
    const run = new RequestRun();
    const listener = vi.fn();
    run.subscribe(listener);
    void run.start(wire.transport);

    wire.cb.onStreamingUpdate("a");
    wire.cb.onStreamingUpdate("a b");
    wire.cb.onStreamingUpdate("a b c");

    expect(frames).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
    expect(run.getSnapshot().text).toBe("a b c");

    frames[0]();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
