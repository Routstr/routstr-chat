import { describe, expect, it } from "vitest";
import { createPnsEvent, derivePnsKeys, decryptPnsEvent } from "@/lib/pns";
import type { Message, MessageContent } from "@/types/chat";
import { decodeMessage, encodeMessage, ROOT_ID } from "../codec";

const keys = derivePnsKeys(new Uint8Array(32).fill(7));
const AUTHOR = "a".repeat(64);
const PARENT = "p".repeat(64);

const roundTrip = (message: Message, conversationId = "1789000000000") => {
  const event = encodeMessage(
    conversationId,
    message,
    AUTHOR,
    1789000000,
    keys
  );
  return { event, entry: decodeMessage(event, keys) };
};

describe("history codec", () => {
  it("writes the inner event main writes, field for field and in order", () => {
    const { event } = roundTrip({
      role: "assistant",
      content: "hi",
      _prevId: PARENT,
    });

    expect(JSON.stringify(decryptPnsEvent(event, keys))).toBe(
      JSON.stringify({
        kind: 20001,
        pubkey: AUTHOR,
        created_at: 1789000000,
        tags: [
          ["d", "1789000000000"],
          ["role", "assistant"],
          ["client", "routstr-chat"],
          ["e", PARENT],
          ["model", "unknown-model"],
        ],
        content: "hi",
      })
    );
    expect(event.kind).toBe(1080);
    expect(event.pubkey).toBe(keys.pnsKeypair.pubKey);
    expect(event.tags).toEqual([]);
  });

  it("comes back keyed by the outer event id", () => {
    const { event, entry } = roundTrip({
      role: "assistant",
      content: "Blind signatures.",
      _prevId: PARENT,
      _modelId: "claude-sonnet-5",
    });

    expect(entry).toEqual({
      conversationId: "1789000000000",
      message: {
        role: "assistant",
        content: "Blind signatures.",
        _eventId: event.id,
        _prevId: PARENT,
        _createdAt: 1789000000,
        _modelId: "claude-sonnet-5",
      },
    });
  });

  it("writes no parent tag for a message that has none, as main's migration did", () => {
    const { event, entry } = roundTrip({ role: "user", content: "old" });

    expect(decryptPnsEvent(event, keys).tags).not.toContainEqual(
      expect.arrayContaining(["e"])
    );
    expect(entry?.message._prevId).toBeUndefined();
  });

  it("keeps attachments and reasoning as structured content", () => {
    const content: MessageContent[] = [
      { type: "text", text: "Look", thinking: "hm" },
      { type: "image_url", image_url: { url: "", storageId: "img-1" } },
    ];

    expect(
      roundTrip({ role: "user", content, _prevId: ROOT_ID }).entry?.message
        .content
    ).toEqual(content);
  });

  it("keeps a message that is itself JSON as the text the person typed", () => {
    for (const typed of [
      '{"a":1}',
      "[1,2,3]",
      '[{"no":"type"}]',
      '[{"type":"text"},{"no":"type"}]',
      "[]",
      "null",
    ]) {
      expect(
        roundTrip({ role: "user", content: typed }).entry?.message.content
      ).toBe(typed);
    }
  });

  it("reads only chat messages out of a history event", () => {
    const other = createPnsEvent(
      {
        kind: 1,
        pubkey: AUTHOR,
        created_at: 1,
        tags: [["d", "c1"]],
        content: "x",
      },
      keys
    );

    expect(decodeMessage(other, keys)).toBeNull();
  });

  it("cannot read another account's history", () => {
    const { event } = roundTrip({ role: "user", content: "secret" });

    expect(
      decodeMessage(event, derivePnsKeys(new Uint8Array(32).fill(9)))
    ).toBeNull();
  });
});
