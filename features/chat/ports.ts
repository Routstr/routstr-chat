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

/** Stored attachments, over the file store. */
export interface Attachments {
  /** A missing attachment is left out, never failed on. Settles soon after
   *  `signal` aborts, so Stop never waits on a slow file server. */
  forRequest(history: Message[], signal: AbortSignal): Promise<ApiMessage[]>;
  /** Stores the files a message carries inline; returns the message to save,
   *  which carries none. `signal` (Stop) ends a slow upload at once. */
  forSave(message: Message, signal: AbortSignal): Promise<Message>;
}

/** Where a message's attachment is kept, as main stores it. */
export interface StoredFile {
  /** Its id in this device's file store. */
  storageId?: string;
  /** Its encrypted copy on Blossom, for the account's other devices. */
  blossomHash?: string;
  blossomServers?: string[];
}

/** Whether files are copied to Blossom, and to which servers. Device-wide,
 *  in main's keys. */
export interface FileSync {
  on: boolean;
  servers: string[];
}

/** The servers files go to until the person picks others (main's). */
export const DEFAULT_FILE_SERVERS = [
  "https://blossom.primal.net",
  "https://cdn.nostr.build",
];

/** The device's file store and the account's Blossom copies. */
export interface FileStore {
  /** The file as a data URL, or undefined when no copy can be reached.
   *  A copy fetched from Blossom is kept here too. Settles soon after
   *  `signal` aborts. */
  load(file: StoredFile, signal: AbortSignal): Promise<string | undefined>;
  /** Keeps a data URL's file here and, while file sync is on, on Blossom
   *  until `signal` aborts. Returns only the copies made; never rejects. */
  store(dataUrl: string, signal: AbortSignal): Promise<StoredFile>;
}

/** The file store as screens use it: a file taken into the composer is kept
 *  here at once and copied to Blossom in the background. */
export interface Files extends FileStore {
  /** Keeps it on this device only: its id, or undefined when it cannot. */
  keep(dataUrl: string): Promise<string | undefined>;
  /** Copies it to Blossom while file sync is on and the account's history
   *  is open; only the copies made, never rejects. */
  copy(dataUrl: string, signal: AbortSignal): Promise<StoredFile>;
  sync(): FileSync;
  setSync(change: Partial<FileSync>): void;
  /** Calls `listener` when the sync setting changes in this tab. */
  subscribe(listener: () => void): () => void;
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
