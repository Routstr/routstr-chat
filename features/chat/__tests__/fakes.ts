import { vi } from "vitest";
import type { Message } from "@/types/chat";
import type {
  ApiMessage,
  Attachments,
  ChatHistory,
  Pay,
  StoredMessage,
} from "../ports";
import type { RunCallbacks } from "../run";

const ROOT = "0".repeat(64);

/** History in memory: versions hang off their parent, the newest is shown. */
export class FakeHistory implements ChatHistory {
  private stored: StoredMessage[] = [];
  private shown = new Map<string, string>();
  private next = 0;
  /** Set to make the next saves fail. */
  failing: Error | null = null;
  saves: Array<{ conversationId: string; message: Message }> = [];

  /** Like history: system notes old clients saved are left out. */
  branch = (conversationId: string): StoredMessage[] => {
    const path: StoredMessage[] = [];
    let parent = ROOT;
    for (;;) {
      const children = this.stored.filter(
        (m) => m._prevId === parent && this.conversationOf(m) === conversationId
      );
      if (!children.length) return path.filter((m) => m.role !== "system");
      const shown = children.find((m) => m._eventId === this.shown.get(parent));
      const next = shown ?? children.at(-1)!;
      path.push(next);
      parent = next._eventId;
    }
  };

  /** A chain written earlier, by this app or an old one. */
  seed(conversationId: string, messages: Message[]): void {
    let parent = ROOT;
    for (const message of messages) {
      const stored = {
        ...message,
        _prevId: parent,
        _eventId: `${conversationId}:${++this.next}`,
      };
      this.stored.push(stored);
      parent = stored._eventId;
    }
  }

  save = vi.fn(
    async (
      conversationId: string,
      message: Message & { _prevId: string }
    ): Promise<StoredMessage> => {
      await Promise.resolve();
      if (this.failing) throw this.failing;
      const stored = {
        ...message,
        _eventId: `${conversationId}:${++this.next}`,
      } as StoredMessage;
      this.stored.push(stored);
      this.shown.set(message._prevId, stored._eventId);
      this.saves.push({ conversationId, message });
      return stored;
    }
  );

  private conversationOf(message: StoredMessage) {
    return message._eventId.split(":")[0];
  }
}

export const passThroughAttachments = (): Attachments => ({
  forRequest: vi.fn(async (history: Message[]) =>
    history.map(({ role, content }) => ({ role, content }) as ApiMessage)
  ),
  forSave: vi.fn(async (reply: Message) => reply),
});

/** A provider the test answers by hand. */
export function manualPay() {
  const calls: Array<{
    messages: ApiMessage[];
    callbacks: RunCallbacks;
    signal: AbortSignal;
    settle(): void;
    fail(error: Error): void;
  }> = [];
  const pay = vi.fn<Pay>(
    ({ messages }, callbacks, signal) =>
      new Promise<void>((settle, fail) =>
        calls.push({ messages, callbacks, signal, settle, fail })
      )
  );
  return {
    pay,
    calls,
    get last() {
      return calls.at(-1)!;
    },
    /** Streams `text`, ends the answer and settles the payment. */
    answer(text: string) {
      const call = calls.at(-1)!;
      call.callbacks.onStreamingUpdate(text);
      call.callbacks.onMessageAppend({ role: "assistant", content: text });
      call.callbacks.onStreamingUpdate("");
      call.settle();
    },
  };
}

export const contents = (messages: { content: unknown }[]) =>
  messages.map((m) => m.content);

/** localStorage, in memory. */
export { memoryStorage } from "@/features/book/journal";
