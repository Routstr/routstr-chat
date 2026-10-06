import type { StreamingCallbacks } from "@routstr/sdk";
import type { Message } from "@/types/chat";

export type RequestPhase =
  | "preparing"
  | "paying"
  | "thinking"
  | "answering"
  | "done"
  | "stopped"
  | "failed";

export interface RunSnapshot {
  phase: RequestPhase;
  text: string;
  thinking: string;
  thinkingMs?: number;
  /** Key of this request in the SDK usage log, where its real cost is recorded. */
  requestId?: string;
  /** The answer to save: the full reply, or what arrived before Stop or a failure. */
  message?: Message;
  error?: string;
  /** Something the person should know that did not stop the answer. */
  warning?: string;
}

export type RunCallbacks = Pick<
  StreamingCallbacks,
  | "onStreamingUpdate"
  | "onThinkingUpdate"
  | "onMessageAppend"
  | "onPaymentProcessing"
  | "onRequestId"
>;

/** Makes the request and resolves once its payment is settled. */
export type Transport = (
  callbacks: RunCallbacks & { onWarning(text: string): void },
  signal: AbortSignal
) => Promise<void>;

const isTerminal = (phase: RequestPhase) =>
  phase === "done" || phase === "stopped" || phase === "failed";

// A hidden tab gets no animation frames, so only rendering may wait on this
const nextFrame = (flush: () => void) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
  else queueMicrotask(flush);
};

/**
 * One paid request, owned outside React. It ends when the answer ends (or at
 * Stop or a failure), which is when the answer can be saved; the payment
 * settles after that, on its own promise. The SDK clears the text with ""
 * when it ends or aborts, so empty updates are ignored and the text is kept.
 */
export class RequestRun {
  private snapshot: RunSnapshot = {
    phase: "preparing",
    text: "",
    thinking: "",
  };
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private thinkingStartedAt: number | undefined;
  private notifyScheduled = false;
  private resolveEnded!: () => void;

  /** `parentId`: the message the answer hangs off, the question it answers. */
  constructor(readonly parentId?: string) {}

  /** Resolves at the first end state (done, stopped or failed); the answer
   *  is then the snapshot's `message`. */
  readonly ended = new Promise<void>((resolve) => {
    this.resolveEnded = resolve;
  });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RunSnapshot => this.snapshot;

  /** Makes the request and resolves when its payment is settled. It never
   *  rejects: a failure before the answer ends fails the run, one after it
   *  becomes a warning. The run keeps no hold on `transport`, so the files it
   *  sends are let go once the request is over. */
  async start(transport: Transport): Promise<void> {
    if (this.controller.signal.aborted) return;
    try {
      await transport(
        { ...this.callbacks, onWarning: (warning) => this.warn(warning) },
        this.controller.signal
      );
      this.finish("failed", { error: "The provider did not answer." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isTerminal(this.snapshot.phase)) {
        this.finish("failed", { error: message });
      } else if ((error as Error)?.name !== "AbortError") {
        this.warn(`The payment did not finish cleanly (${message}).`);
      }
    }
  }

  /** Ends the answer here. Once it has ended, the payment is left to settle. */
  stop(): void {
    if (isTerminal(this.snapshot.phase)) return;
    this.controller.abort();
    this.finish("stopped", {});
  }

  /** The answer is on disk: the run keeps that copy, which holds no file
   *  bytes, in place of the one it was sent. */
  saved(message: Message): void {
    this.update({ message });
  }

  warn(warning: string): void {
    this.update({ warning });
  }

  private callbacks: RunCallbacks = {
    // The SDK says "false" only after the answer, so paying lasts until the first token
    onPaymentProcessing: (isProcessing) => {
      if (isProcessing && this.snapshot.phase === "preparing") {
        this.update({ phase: "paying" });
      }
    },
    onThinkingUpdate: (thinking) => {
      if (!thinking || isTerminal(this.snapshot.phase)) return;
      this.thinkingStartedAt ??= Date.now();
      this.update({ phase: "thinking", thinking });
    },
    onStreamingUpdate: (text) => {
      if (!text || isTerminal(this.snapshot.phase)) return;
      this.update({ phase: "answering", text, ...this.thinkingDuration() });
    },
    onMessageAppend: (message) => {
      if (message.role === "system") {
        // the SDK's own notes are plain text
        this.finish("failed", { error: String(message.content) });
      } else {
        this.finish("done", { message: this.withThinking(message) });
      }
    },
    // Arrives after the answer has ended, and still belongs to this request
    onRequestId: (requestId) => this.update({ requestId }),
  };

  private finish(
    phase: "done" | "stopped" | "failed",
    result: Pick<RunSnapshot, "message" | "error">
  ): void {
    if (isTerminal(this.snapshot.phase)) return;
    const { text } = this.snapshot;
    const partial =
      phase !== "done" && text
        ? { message: this.withThinking({ role: "assistant", content: text }) }
        : {};
    this.update({ phase, ...this.thinkingDuration(), ...partial, ...result });
    this.resolveEnded();
  }

  private thinkingDuration(): Pick<RunSnapshot, "thinkingMs"> {
    if (this.thinkingStartedAt === undefined) return {};
    if (this.snapshot.thinkingMs !== undefined) return {};
    return { thinkingMs: Date.now() - this.thinkingStartedAt };
  }

  // The SDK returns a text-only reply as a bare string, which drops the reasoning
  private withThinking(message: Message): Message {
    const { thinking } = this.snapshot;
    if (!thinking || typeof message.content !== "string") return message;
    return {
      ...message,
      content: [{ type: "text", text: message.content, thinking }],
    };
  }

  private update(patch: Partial<RunSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    nextFrame(() => {
      this.notifyScheduled = false;
      this.listeners.forEach((listener) => listener());
    });
  }
}
