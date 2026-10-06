import type { Conversation } from "@/types/chat";
import type { FakeHistory, FakeHistoryHooks } from "@/components/v2/lab/FakeChat";
import type { HistoryStatus, SyncOutcome } from "@/features/history/service";
import type { Stored } from "@/features/history/codec";
import { buildThread, type ThreadSlot } from "@/features/history/thread";

/* Development only. The lab's simulated chats behind the history view, so the
   real screens read them the way they read an account's history. */

const NONE = new Map<number, string>();

class LabHistory {
  private listeners = new Set<() => void>();
  private chats: Conversation[] = [];
  private status: HistoryStatus = "ready";
  private selected = new Map<string, Map<number, string>>();
  private views = new Map<string, { messages: Conversation["messages"]; picks: Map<number, string>; slots: ThreadSlot[] }>();

  constructor(private hooks: FakeHistoryHooks) {}

  /** The lab's state changed: screens read it again. */
  update(chats: Conversation[], syncing: boolean): void {
    this.chats = chats;
    this.status = syncing ? "loading" : "ready";
    this.listeners.forEach((listener) => listener());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getStatus = () => this.status;
  getConversations = () => this.chats;
  getThread = (id: string): ThreadSlot[] | undefined => {
    const chat = this.chats.find((c) => c.id === id);
    if (!chat) return undefined;
    const picks = this.selected.get(id) ?? NONE;
    const cached = this.views.get(id);
    if (cached?.messages === chat.messages && cached.picks === picks) return cached.slots;
    const slots = buildThread(chat.messages as Stored[], picks);
    this.views.set(id, { messages: chat.messages, picks, slots });
    return slots;
  };
  selectVersion = (id: string, depth: number, key: string) => {
    this.selected.set(id, new Map(this.selected.get(id)).set(depth, key));
    this.listeners.forEach((listener) => listener());
  };
  remove = async (id: string) => this.hooks.remove(id);
  sync = async (): Promise<SyncOutcome> => {
    await this.hooks.sync();
    return "ok";
  };
  writingKeys = () => undefined;
}

/** It fills only what screens read of a history service. */
export const labHistory = (hooks: FakeHistoryHooks) =>
  new LabHistory(hooks) as unknown as FakeHistory;
