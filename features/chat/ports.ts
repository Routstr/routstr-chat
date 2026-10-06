import type { Message as ApiMessage } from "@routstr/sdk";
import type { Message } from "@/types/chat";
import type { RunCallbacks } from "./run";

/** A message as the provider receives it: attachments loaded. */
export type { ApiMessage };

export type StoredMessage = Message & { _eventId: string; _prevId: string };

/** One account's conversations (the history service). */
export interface ChatHistory {
  /** The branch on screen, root first, without system notes. */
  branch(conversationId: string): StoredMessage[];
  /** Resolves only once the message is on disk; it becomes the shown
   *  version at its place. A rejection means nothing was saved. */
  save(
    conversationId: string,
    message: Message & { _prevId: string }
  ): Promise<StoredMessage>;
}

/** Stored attachments (the files service). */
export interface Attachments {
  /** A missing attachment is left out, never failed on. Settles soon after
   *  `signal` aborts, so Stop never waits on a slow file server. */
  forRequest(history: Message[], signal: AbortSignal): Promise<ApiMessage[]>;
  /** Stores the images a reply carries; returns the message to save. */
  forSave(reply: Message): Promise<Message>;
}

export interface ChatModel {
  id: string;
  /** A provider the person pinned, passed only while it still routes this model. */
  provider?: string;
  /** False when the model reads text only. */
  images?: boolean;
}

/** Pays for one request and delivers its answer through the callbacks;
 *  resolves once the payment is settled. */
export type Pay = (
  request: { messages: ApiMessage[]; model: ChatModel },
  callbacks: RunCallbacks,
  signal: AbortSignal
) => Promise<void>;
