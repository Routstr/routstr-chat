import { describe, expect, it, vi } from "vitest";
import { ROOT_ID, type Entry, type Stored } from "../codec";
import { HistoryStore } from "../store";

const msg = (
  id: string,
  role: "user" | "assistant" | "system",
  prevId: string,
  createdAt: number,
  content: string = id
): Stored => ({
  role,
  content,
  _eventId: id,
  _prevId: prevId,
  _createdAt: createdAt,
});

const chat = (conversationId: string, messages: Stored[]): Entry[] =>
  messages.map((message) => ({ conversationId, message }));

const retried = () => [
  msg("u1", "user", ROOT_ID, 100, "What is a Cashu mint?"),
  msg("a1", "assistant", "u1", 101),
  msg("a1b", "assistant", "u1", 102),
  msg("u2", "user", "a1b", 103),
  msg("a2", "assistant", "u2", 104),
];

const path = (store: HistoryStore, id: string) =>
  store.getThread(id)?.map((slot) => slot.displayed._eventId) ?? [];

describe("HistoryStore", () => {
  it("keeps one copy of an event that arrives twice", () => {
    const store = new HistoryStore(() => {});
    store.ingest(chat("c1", retried()));
    store.ingest(chat("c1", retried()));

    expect(path(store, "c1")).toEqual(["u1", "a1b", "u2", "a2"]);
    expect(store.getConversations()[0].messages).toHaveLength(5);
  });

  it("switches version and tells subscribers once", () => {
    const listener = vi.fn();
    const store = new HistoryStore(listener);
    store.ingest(chat("c1", retried()));
    listener.mockClear();

    store.selectVersion("c1", 1, "a1");
    store.selectVersion("c1", 1, "a1");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(path(store, "c1")).toEqual(["u1", "a1"]);
  });

  it("shows a message just written here even where an older version was picked", () => {
    const store = new HistoryStore(() => {});
    store.ingest(chat("c1", retried()));
    store.selectVersion("c1", 1, "a1");

    store.ingest(chat("c1", [msg("a1c", "assistant", "u1", 105)]));
    expect(path(store, "c1")).toEqual(["u1", "a1"]);

    store.show("c1", "a1c");
    expect(path(store, "c1")).toEqual(["u1", "a1c"]);
  });

  it("notifies once per burst and keeps other chats' snapshots", () => {
    const listener = vi.fn();
    const store = new HistoryStore(listener);
    store.ingest(chat("c1", retried()));
    const thread = store.getThread("c1");
    const first = store.getConversations().find((c) => c.id === "c1");
    listener.mockClear();

    store.ingest(
      chat("c2", [
        msg("x1", "user", ROOT_ID, 200),
        msg("x2", "assistant", "x1", 201),
      ])
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getThread("c1")).toBe(thread);
    expect(store.getConversations().find((c) => c.id === "c1")).toBe(first);
  });

  it("lists chats newest first, titled by their first message, without system notes", () => {
    const store = new HistoryStore(() => {});
    store.ingest(chat("old", retried()));
    store.ingest(
      chat("new", [
        msg("n1", "user", ROOT_ID, 500, "Newest chat"),
        msg("n2", "system", "n1", 501, "Uncaught Error"),
      ])
    );

    const list = store.getConversations();
    expect(list.map((c) => [c.id, c.title])).toEqual([
      ["new", "Newest chat"],
      ["old", "What is a Cashu mint?"],
    ]);
    expect(list[0].messages.map((m) => m._eventId)).toEqual(["n1"]);
    expect(store.getConversations()).toBe(list);
  });

  it("drops deleted events, and the chat once none is left", () => {
    const store = new HistoryStore(() => {});
    store.ingest(chat("c1", retried()));
    store.ingest(chat("c2", [msg("x1", "user", ROOT_ID, 200)]));

    store.remove(["a2"]);
    expect(path(store, "c1")).toEqual(["u1", "a1b", "u2"]);

    store.remove(store.eventIds("c2"));
    expect(store.getThread("c2")).toBeUndefined();
    expect(store.getConversations().map((c) => c.id)).toEqual(["c1"]);
    expect(store.eventIds("c2")).toEqual([]);
  });
});
