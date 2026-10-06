import type { Message } from "@/types/chat";
import type {
  ApiMessage,
  Attachments,
  ChatHistory,
  ChatModel,
  Pay,
  StoredMessage,
} from "./ports";
import type { ReplyCosts } from "./costs";
import { RequestRun, type Transport } from "./run";

const ROOT_ID = "0".repeat(64);

export interface ChatDeps {
  history: ChatHistory;
  attachments: Attachments;
  pay: Pay;
  costs: Pick<ReplyCosts, "record">;
}

export interface Turn {
  run: RequestRun;
  /** The answer on disk, or undefined when none arrived or it could not be
   *  saved (the run's warning says which). */
  reply: Promise<StoredMessage | undefined>;
  /** The payment finished: the account's payment lock is released. */
  settled: Promise<void>;
}

const mediaCount = (messages: (Message | ApiMessage)[]) =>
  messages.reduce(
    (n, m) =>
      n +
      (Array.isArray(m.content)
        ? m.content.filter((part) => part.type !== "text").length
        : 0),
    0
  );

/**
 * Send, edit and retry for one account. The question is on disk before
 * anything is paid, the model is sent only the branch on screen, and the
 * answer is saved as soon as it ends, while the payment settles on its own.
 */
export class ChatService {
  private runs = new Map<string, RequestRun>();
  /** Conversations with a turn between its first step and its saved answer. */
  private claims = new Map<string, AbortController>();
  private open = new Set<Promise<unknown>>();
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(private deps: ChatDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRun = (conversationId: string): RequestRun | undefined =>
    this.runs.get(conversationId);

  /** Calls `listener` when this conversation's run changes or a new run
   *  replaces it. */
  watch(conversationId: string, listener: () => void): () => void {
    let run = this.getRun(conversationId);
    let unwatchRun = run?.subscribe(listener);
    const unsubscribe = this.subscribe(() => {
      if (this.getRun(conversationId) === run) return;
      unwatchRun?.();
      run = this.getRun(conversationId);
      unwatchRun = run?.subscribe(listener);
      listener();
    });
    return () => {
      unwatchRun?.();
      unsubscribe();
    };
  }

  /** A turn of this conversation has not saved its answer yet. */
  asking = (conversationId: string): boolean => this.claims.has(conversationId);

  /** A turn of this account has not finished paying yet. */
  busy = (): boolean => this.open.size > 0;

  send(
    conversationId: string,
    content: Message["content"],
    model: ChatModel
  ): Promise<Turn> {
    const at = this.deps.history.branch(conversationId).length;
    return this.ask(conversationId, at, content, model);
  }

  /** The edited question becomes a new version of the one at `depth`. */
  edit(
    conversationId: string,
    depth: number,
    content: Message["content"],
    model: ChatModel
  ): Promise<Turn> {
    return this.ask(conversationId, depth, content, model);
  }

  /** A new answer becomes a new version of the one at `depth`. */
  async retry(
    conversationId: string,
    depth: number,
    model: ChatModel
  ): Promise<Turn> {
    const claim = this.claim(conversationId);
    const branch = this.deps.history.branch(conversationId);
    return this.answer(
      conversationId,
      claim,
      model,
      branch.slice(0, depth),
      parentAt(branch, depth)
    );
  }

  /** Stops the turn of this conversation, keeping what arrived. */
  stop(conversationId: string): void {
    this.claims.get(conversationId)?.abort();
    this.runs.get(conversationId)?.stop();
  }

  /** Stops every turn and resolves once each one has saved what arrived and
   *  finished paying, so a switch of account can wait for it. */
  async stopAll(): Promise<void> {
    for (const id of this.claims.keys()) this.stop(id);
    await Promise.all(this.open);
  }

  /** The account is no longer the one in use: nothing new starts. */
  dispose(): void {
    this.disposed = true;
    for (const id of this.claims.keys()) this.stop(id);
  }

  private async ask(
    conversationId: string,
    depth: number,
    content: Message["content"],
    model: ChatModel
  ): Promise<Turn> {
    const claim = this.claim(conversationId);
    const branch = this.deps.history.branch(conversationId);
    let question: StoredMessage;
    try {
      question = await this.deps.history.save(conversationId, {
        role: "user",
        content,
        _prevId: parentAt(branch, depth),
      });
    } catch (error) {
      this.release(conversationId, claim);
      throw error;
    }
    return this.answer(
      conversationId,
      claim,
      model,
      [...branch.slice(0, depth), question],
      question._eventId
    );
  }

  private answer(
    conversationId: string,
    claim: AbortController,
    model: ChatModel,
    history: Message[],
    parentId: string
  ): Turn {
    const run = new RequestRun(this.transport(history, model));
    if (claim.signal.aborted) run.stop();
    this.runs.set(conversationId, run);
    const settled = run.start();
    const reply = run.ended
      .then((end) =>
        this.saveReply(conversationId, run, end.message, parentId, model)
      )
      .finally(() => this.release(conversationId, claim));
    const turn = Promise.all([settled, reply]);
    this.open.add(turn);
    turn.finally(() => {
      this.open.delete(turn);
      this.notify();
    });
    // the usage log has the real cost once the payment settled
    void turn
      .then(([, saved]) => {
        const { requestId } = run.getSnapshot();
        if (saved && requestId) {
          return this.deps.costs.record(saved._eventId, requestId);
        }
      })
      .catch((error) =>
        console.warn("Could not record what a reply cost", error)
      );
    this.notify();
    return { run, reply, settled };
  }

  private transport(history: Message[], model: ChatModel): Transport {
    return async (callbacks, signal) => {
      const sent =
        model.images === false
          ? withoutImages(history, callbacks.onWarning)
          : history;
      const messages = await this.deps.attachments.forRequest(sent, signal);
      if (signal.aborted) return;
      checkAttachments(sent, messages, callbacks.onWarning);
      await this.deps.pay({ messages, model }, callbacks, signal);
    };
  }

  private async saveReply(
    conversationId: string,
    run: RequestRun,
    message: Message | undefined,
    parentId: string,
    model: ChatModel
  ): Promise<StoredMessage | undefined> {
    if (!message) return undefined;
    try {
      const kept = await this.deps.attachments.forSave(message);
      return await this.deps.history.save(conversationId, {
        ...kept,
        _prevId: parentId,
        _modelId: model.id,
      });
    } catch (error) {
      run.warn(
        `The answer could not be saved: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  // Claimed before the first await: a second Enter must never pay twice
  private claim(conversationId: string): AbortController {
    if (this.disposed) throw new Error("This account is no longer in use.");
    if (this.claims.has(conversationId)) {
      throw new Error("A reply is already in progress in this conversation.");
    }
    const claim = new AbortController();
    this.claims.set(conversationId, claim);
    this.notify();
    return claim;
  }

  private release(conversationId: string, claim: AbortController): void {
    if (this.claims.get(conversationId) !== claim) return;
    this.claims.delete(conversationId);
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

/** The parent of a new version at `depth`: the replaced message's own
 *  parent, or the message before it when the turn adds a new one. */
function parentAt(branch: StoredMessage[], depth: number): string {
  return branch[depth]?._prevId ?? branch[depth - 1]?._eventId ?? ROOT_ID;
}

/** A text-only model is never sent an image: the question's own image
 *  stops the turn, older ones are left out. */
function withoutImages(
  history: Message[],
  warn: (text: string) => void
): Message[] {
  const isImage = (part: { type: string }) => part.type === "image_url";
  const question = history.at(-1);
  if (Array.isArray(question?.content) && question.content.some(isImage)) {
    throw new Error(
      "This model reads text only. Remove the image or pick a model that sees images."
    );
  }
  if (
    !history.some((m) => Array.isArray(m.content) && m.content.some(isImage))
  ) {
    return history;
  }
  warn("This model reads text only, so earlier images were left out.");
  return history.map((m) =>
    Array.isArray(m.content)
      ? { ...m, content: m.content.filter((part) => !isImage(part)) }
      : m
  );
}

/** Nothing is paid for a question whose attachments are all missing. */
function checkAttachments(
  history: Message[],
  messages: ApiMessage[],
  warn: (text: string) => void
): void {
  const last = messages.at(-1);
  if (
    Array.isArray(history.at(-1)?.content) &&
    typeof last?.content === "string" &&
    !last.content.trim()
  ) {
    throw new Error(
      "This message's attachments could not be loaded, so it was not sent."
    );
  }
  if (mediaCount(messages) < mediaCount(history)) {
    warn("Some attachments could not be loaded and were left out.");
  }
}
