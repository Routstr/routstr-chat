import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/types/chat";
import { createAttachments } from "../attachments";
import { ChatService } from "../service";
import {
  contents,
  FakeHistory,
  manualPay,
  passThroughAttachments,
} from "./fakes";

const model = { id: "m" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let history: FakeHistory;
let provider: ReturnType<typeof manualPay>;
let attachments: ReturnType<typeof passThroughAttachments>;
let chat: ChatService;
let costs: { record: ReturnType<typeof vi.fn> };

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  history = new FakeHistory();
  provider = manualPay();
  attachments = passThroughAttachments();
  costs = { record: vi.fn(async () => {}) };
  chat = new ChatService({
    history,
    attachments,
    pay: provider.pay,
    costs,
  });
});

async function exchange(question: string, answer: string) {
  const turn = await chat.send("c", question, model);
  await flush();
  provider.answer(answer);
  await turn.reply;
  await turn.settled;
}

describe("ChatService: saving before paying", () => {
  it("pays nothing when the question cannot be saved", async () => {
    history.failing = new Error("History is locked");

    await expect(chat.send("c", "hello", model)).rejects.toThrow(
      "History is locked"
    );

    expect(provider.pay).not.toHaveBeenCalled();
    expect(chat.asking("c")).toBe(false);
  });

  it("asks the provider only after the question is on disk", async () => {
    let onDisk = false;
    let onDiskWhenPaid: boolean | undefined;
    history.save.mockImplementationOnce(async (conversationId, message) => {
      await flush();
      onDisk = true;
      return { ...message, _eventId: `${conversationId}:q` };
    });
    provider.pay.mockImplementationOnce(async () => {
      onDiskWhenPaid = onDisk;
    });

    const turn = await chat.send("c", "hello", model);
    await turn.settled;

    expect(onDiskWhenPaid).toBe(true);
  });

  it("pays once for a double Enter", async () => {
    const first = chat.send("c", "hello", model);
    const second = chat.send("c", "hello", model);

    await expect(second).rejects.toThrow("already in progress");
    await first;
    await flush();
    expect(provider.pay).toHaveBeenCalledTimes(1);
    expect(history.saves).toHaveLength(1);
  });

  it("pays nothing when stopped while the question is being saved", async () => {
    const pending = chat.send("c", "hello", model);
    chat.stop("c");
    const turn = await pending;
    await turn.settled;

    expect(provider.pay).not.toHaveBeenCalled();
    expect(turn.run.getSnapshot().phase).toBe("stopped");
    expect(await turn.reply).toBeUndefined();
  });
});

describe("ChatService: what the model is sent", () => {
  it("sends the branch on screen with the new question", async () => {
    await exchange("Q1", "A1");
    await chat.send("c", "Q2", model);
    await flush();

    expect(contents(provider.last.messages)).toEqual(["Q1", "A1", "Q2"]);
  });

  it("never sends an answer that was retried away", async () => {
    await exchange("Q1", "A1");

    const retry = await chat.retry("c", 1, model);
    await flush();
    expect(contents(provider.last.messages)).toEqual(["Q1"]);
    provider.answer("A1b");
    await retry.reply;
    expect(contents(history.branch("c"))).toEqual(["Q1", "A1b"]);

    await chat.send("c", "Q2", model);
    await flush();
    expect(contents(provider.last.messages)).toEqual(["Q1", "A1b", "Q2"]);
  });

  it("files a retried answer as a new version beside the old one", async () => {
    await exchange("Q1", "A1");
    const [question, old] = history.branch("c");

    const retry = await chat.retry("c", 1, model);
    await flush();
    provider.answer("A1b");
    const saved = await retry.reply;

    expect(saved?._prevId).toBe(question._eventId);
    expect(old._prevId).toBe(question._eventId);
  });

  it("keeps an edit a version of the old question when an old error note sits before it", async () => {
    history.seed("c", [
      { role: "user", content: "Q1" },
      { role: "system", content: "Uncaught Error: provider down" },
      { role: "user", content: "Q2" },
    ]);
    const old = history.branch("c")[1];

    const turn = await chat.edit("c", 1, "Q2b", model);
    await flush();

    expect(history.saves[0].message._prevId).toBe(old._prevId);
    expect(contents(provider.last.messages)).toEqual(["Q1", "Q2b"]);
    expect(turn.run.getSnapshot().phase).not.toBe("failed");
  });

  it("sends an edited question without anything after it", async () => {
    await exchange("Q1", "A1");
    await exchange("Q2", "A2");

    await chat.edit("c", 2, "Q2b", model);
    await flush();

    expect(contents(provider.last.messages)).toEqual(["Q1", "A1", "Q2b"]);
    expect(contents(history.branch("c"))).toEqual(["Q1", "A1", "Q2b"]);
  });

  it("answers a question whose answer failed, without a second copy of it", async () => {
    const turn = await chat.send("c", "Q1", model);
    await flush();
    provider.last.callbacks.onMessageAppend({
      role: "system",
      content: "Uncaught Error: provider down",
    });
    provider.last.settle();
    await turn.reply;

    await chat.retry("c", 1, model);
    await flush();

    expect(contents(provider.last.messages)).toEqual(["Q1"]);
  });

  it("never sends a text-only model an image", async () => {
    const image = [
      { type: "text" as const, text: "what is this" },
      { type: "image_url" as const, image_url: { url: "data:x" } },
    ];
    const turn = await chat.send("c", image, { id: "m", images: false });
    await turn.reply;

    expect(provider.pay).not.toHaveBeenCalled();
    expect(turn.run.getSnapshot()).toMatchObject({
      phase: "failed",
      error: expect.stringContaining("reads text only"),
    });

    await chat.retry("c", 1, { id: "m", images: false }).then((t) => t.reply);
    expect(provider.pay).not.toHaveBeenCalled();
  });

  it("leaves earlier images out for a text-only model, and says so", async () => {
    const image = [
      { type: "text" as const, text: "look" },
      { type: "image_url" as const, image_url: { url: "data:x" } },
    ];
    const first = await chat.send("c", image, model);
    await flush();
    provider.answer("a cat");
    await first.reply;

    const turn = await chat.send("c", "and now?", { id: "m", images: false });
    await flush();

    expect(provider.last.messages[0].content).toEqual([
      { type: "text", text: "look" },
    ]);
    expect(turn.run.getSnapshot().warning).toContain("left out");
  });

  it("says so when some attachments could not be loaded", async () => {
    vi.mocked(attachments.forRequest).mockResolvedValueOnce([
      { role: "user", content: [{ type: "text", text: "two files" }] },
    ]);
    const files = [
      { type: "text" as const, text: "two files" },
      { type: "file" as const, file: { url: "", storageId: "kept" } },
    ];

    const turn = await chat.send("c", files, model);
    await flush();

    expect(provider.pay).toHaveBeenCalledTimes(1);
    expect(turn.run.getSnapshot().warning).toContain("left out");
  });

  it("saves a question without its inline files, and still sends them as attached", async () => {
    const kept = [
      { type: "image_url" as const, image_url: { url: "", storageId: "kept" } },
    ];
    vi.mocked(attachments.forSave).mockImplementationOnce(async (message) => ({
      ...message,
      content: kept,
    }));
    const image = [
      {
        type: "image_url" as const,
        image_url: { url: "data:image/png;base64,AA", storageId: "kept" },
      },
    ];

    await chat.send("c", image, model);
    await flush();

    expect(history.saves[0].message.content).toEqual(kept);
    const [sent] = vi.mocked(attachments.forRequest).mock.calls[0];
    expect(sent.at(-1)?.content).toEqual(image);
  });

  it("pays nothing when the question's attachments cannot be loaded", async () => {
    vi.mocked(attachments.forRequest).mockResolvedValueOnce([
      { role: "user", content: "" },
    ]);
    const file = [
      { type: "file" as const, file: { url: "", storageId: "gone" } },
    ];

    const turn = await chat.send("c", file, model);
    await turn.settled;

    expect(provider.pay).not.toHaveBeenCalled();
    expect(turn.run.getSnapshot().error).toContain("could not be loaded");
  });
});

describe("ChatService: files", () => {
  const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

  it("keeps no file bytes in history or in the finished run", async () => {
    const files = {
      load: vi.fn(async () => IMAGE),
      store: vi.fn(async () => ({ storageId: "kept" })),
    };
    chat = new ChatService({
      history,
      attachments: createAttachments(files),
      pay: provider.pay,
      costs,
    });
    const question = [
      { type: "text" as const, text: "draw it again" },
      { type: "image_url" as const, image_url: { url: IMAGE, storageId: "q" } },
    ];

    const turn = await chat.send("c", question, model);
    await flush();
    provider.last.callbacks.onMessageAppend({
      role: "assistant",
      content: [{ type: "image_url", image_url: { url: IMAGE } }],
    });
    provider.last.settle();
    await turn.reply;

    expect(JSON.stringify(history.saves)).not.toContain("data:");
    expect(JSON.stringify(turn.run.getSnapshot())).not.toContain("data:");
  });

  // a save that waits on a file server until Stop
  const slowUntilStopped = (message: Message, signal: AbortSignal) =>
    new Promise<Message>((resolve) =>
      signal.addEventListener("abort", () => resolve(message))
    );

  it("saves the answer at once when Stop ends a slow upload", async () => {
    vi.mocked(attachments.forSave)
      .mockImplementationOnce(async (message) => message)
      .mockImplementationOnce(slowUntilStopped);
    const turn = await chat.send("c", "draw a cat", model);
    await flush();
    provider.answer("a cat");
    await flush();
    expect(chat.asking("c")).toBe(true);

    chat.stop("c");

    expect(await turn.reply).toMatchObject({ content: "a cat" });
    expect(chat.asking("c")).toBe(false);
  });

  it("pays nothing when Stop ends a slow upload of the question", async () => {
    vi.mocked(attachments.forSave).mockImplementationOnce(slowUntilStopped);
    const asking = chat.send("c", "draw a cat", model);
    await flush();

    chat.stop("c");
    const turn = await asking;
    await Promise.all([turn.reply, turn.settled]);

    expect(history.saves).toHaveLength(1);
    expect(provider.pay).not.toHaveBeenCalled();
    expect(chat.asking("c")).toBe(false);
  });
});

describe("ChatService: answer and payment are separate", () => {
  it("saves the answer while the payment is still settling", async () => {
    const turn = await chat.send("c", "Q1", model);
    await flush();
    provider.last.callbacks.onMessageAppend({
      role: "assistant",
      content: "A1",
    });

    const saved = await turn.reply;

    expect(saved?.content).toBe("A1");
    expect(chat.busy()).toBe(true);
    expect(chat.asking("c")).toBe(false);
    provider.last.settle();
    await turn.settled;
    await flush();
    expect(chat.busy()).toBe(false);
  });

  it("finishes paying when the answer cannot be saved", async () => {
    const turn = await chat.send("c", "Q1", model);
    await flush();
    history.failing = new Error("signer refused");
    provider.answer("A1");

    expect(await turn.reply).toBeUndefined();
    await turn.settled;
    expect(turn.run.getSnapshot().warning).toContain("signer refused");
    expect(chat.asking("c")).toBe(false);
  });

  it("keeps the answer when the payment cannot finish", async () => {
    const turn = await chat.send("c", "Q1", model);
    await flush();
    provider.last.callbacks.onMessageAppend({
      role: "assistant",
      content: "A1",
    });
    provider.last.fail(new Error("disk full"));

    expect((await turn.reply)?.content).toBe("A1");
    await turn.settled;
    expect(turn.run.getSnapshot().warning).toContain("disk full");
  });

  it("keeps what arrived before Stop", async () => {
    const turn = await chat.send("c", "Q1", model);
    await flush();
    provider.last.callbacks.onStreamingUpdate("half an");

    chat.stop("c");

    expect((await turn.reply)?.content).toBe("half an");
    expect(provider.last.signal.aborted).toBe(true);
  });

  it("writes no error into history", async () => {
    const turn = await chat.send("c", "Q1", model);
    await flush();
    provider.last.callbacks.onMessageAppend({
      role: "system",
      content: "Uncaught Error: Insufficient balance",
    });
    provider.last.settle();

    expect(await turn.reply).toBeUndefined();
    expect(history.saves.map((s) => s.message.role)).toEqual(["user"]);
    expect(turn.run.getSnapshot().error).toContain("Insufficient balance");
  });
});

describe("ChatService: what a reply cost", () => {
  it("records the cost by reply event id once the payment settled", async () => {
    const turn = await chat.send("c", "Q1", { id: "m1" });
    await flush();
    provider.last.callbacks.onMessageAppend({
      role: "assistant",
      content: "A1",
    });
    const saved = await turn.reply;
    expect(costs.record).not.toHaveBeenCalled();

    provider.last.callbacks.onRequestId?.("req-7");
    provider.last.settle();
    await turn.settled;
    await flush();

    expect(costs.record).toHaveBeenCalledWith(saved!._eventId, "req-7");
  });

  it("records nothing for a turn without a saved answer", async () => {
    const warn = vi.spyOn(console, "warn");
    const turn = await chat.send("c", "Q1", model);
    await flush();
    provider.last.callbacks.onRequestId?.("req-7");
    provider.last.callbacks.onMessageAppend({
      role: "system",
      content: "Uncaught Error: down",
    });
    provider.last.settle();
    await turn.settled;
    await flush();

    expect(costs.record).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("ChatService: watching a conversation", () => {
  it("follows each new run of the conversation, and only its own", async () => {
    vi.stubGlobal("requestAnimationFrame", (flush: () => void) => flush());
    const listener = vi.fn();
    const unwatch = chat.watch("c", listener);

    const first = await chat.send("c", "Q1", model);
    expect(listener).toHaveBeenCalled();
    await flush();
    listener.mockClear();
    provider.last.callbacks.onStreamingUpdate("A");
    expect(listener).toHaveBeenCalled();
    provider.answer("A1");
    await first.reply;

    listener.mockClear();
    await chat.send("other", "Q", model);
    await flush();
    provider.last.callbacks.onStreamingUpdate("not mine");
    expect(listener).not.toHaveBeenCalled();

    await chat.send("c", "Q2", model);
    await flush();
    listener.mockClear();
    provider.last.callbacks.onStreamingUpdate("B");
    expect(listener).toHaveBeenCalled();

    unwatch();
    listener.mockClear();
    provider.last.callbacks.onStreamingUpdate("B more");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("ChatService: account lifetime", () => {
  it("starts nothing after it is disposed", async () => {
    chat.dispose();

    await expect(chat.send("c", "hello", model)).rejects.toThrow("no longer");
    await expect(chat.retry("c", 0, model)).rejects.toThrow("no longer");
    expect(history.save).not.toHaveBeenCalled();
  });

  it("stops every reply and waits until each is saved and paid", async () => {
    const a = await chat.send("a", "Qa", model);
    const b = await chat.send("b", "Qb", model);
    await flush();
    provider.calls[0].callbacks.onStreamingUpdate("partial a");

    let done = false;
    const stopped = chat.stopAll().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    provider.calls.forEach((call) => call.settle());
    await stopped;

    expect((await a.reply)?.content).toBe("partial a");
    expect(await b.reply).toBeUndefined();
    expect(chat.busy()).toBe(false);
  });

  it("runs turns of different conversations side by side", async () => {
    await chat.send("a", "Qa", model);
    await chat.send("b", "Qb", model);
    await flush();

    expect(provider.pay).toHaveBeenCalledTimes(2);
    expect(chat.asking("a") && chat.asking("b")).toBe(true);
  });
});
