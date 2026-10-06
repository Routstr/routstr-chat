import { describe, expect, it } from "vitest";
import type { Stored } from "../codec";
import { ROOT_ID } from "../codec";
import { buildThread, byTime, titleOf } from "../thread";

const msg = (
  id: string,
  role: "user" | "assistant" | "system",
  prevId: string | undefined,
  createdAt: number,
  content: string = id
): Stored => ({
  role,
  content,
  _eventId: id,
  _prevId: prevId,
  _createdAt: createdAt,
});

/** u1 -> a1, "Try again" makes a1b a sibling, then u2 -> a2 under a1b. */
const retried = () => [
  msg("u1", "user", ROOT_ID, 100, "What is a Cashu mint?"),
  msg("a1", "assistant", "u1", 101),
  msg("a1b", "assistant", "u1", 102),
  msg("u2", "user", "a1b", 103),
  msg("a2", "assistant", "u2", 104),
];

const shown = (messages: Stored[], selected = new Map<number, string>()) =>
  buildThread(messages, selected).map((slot) => slot.displayed._eventId);

describe("buildThread", () => {
  it("shows the newest version and only the branch under it", () => {
    expect(shown(retried())).toEqual(["u1", "a1b", "u2", "a2"]);
  });

  it("follows a picked version and drops the branch below the other one", () => {
    expect(shown(retried(), new Map([[1, "a1"]]))).toEqual(["u1", "a1"]);
  });

  it("is the same whatever order the events arrive in", () => {
    expect(shown(retried().reverse())).toEqual(["u1", "a1b", "u2", "a2"]);
  });

  it("gives each shown message the parent it hangs off", () => {
    const slots = buildThread(retried(), new Map());

    expect(slots.map((slot) => slot.displayed._prevId)).toEqual([
      ROOT_ID,
      "u1",
      "a1b",
      "u2",
    ]);
    expect(slots[1].keys).toEqual(["a1", "a1b"]);
    expect(slots[1].displayedIndex).toBe(1);
  });

  it("treats an edited first question as a version of the first one", () => {
    const slots = buildThread(
      [
        msg("u1", "user", ROOT_ID, 100),
        msg("a1", "assistant", "u1", 101),
        msg("u1b", "user", ROOT_ID, 102),
        msg("a1c", "assistant", "u1b", 103),
      ],
      new Map()
    );

    expect(slots.map((slot) => slot.displayed._eventId)).toEqual([
      "u1b",
      "a1c",
    ]);
    expect(slots[0].keys).toEqual(["u1", "u1b"]);
  });

  it("puts an answer saved as a root (its question failed to save) under its question", () => {
    expect(
      shown([
        msg("u1", "user", ROOT_ID, 100),
        msg("a1", "assistant", ROOT_ID, 101),
      ])
    ).toEqual(["u1", "a1"]);
  });

  it("threads main's migrated chats, which have no parents, by their order", () => {
    const slots = buildThread(
      [
        msg("q", "user", undefined, 100),
        msg("t1", "assistant", undefined, 101),
        msg("t2", "assistant", undefined, 102),
        msg("f", "user", undefined, 103),
      ],
      new Map()
    );

    expect(slots.map((slot) => slot.displayed._eventId)).toEqual([
      "q",
      "t2",
      "f",
    ]);
    expect(slots[1].keys).toEqual(["t1", "t2"]);
  });

  it("leaves out saved system notes and keeps what hung off them", () => {
    expect(
      shown([
        msg("u1", "user", ROOT_ID, 100),
        msg("s1", "system", "u1", 101, "Uncaught Error: boom"),
        msg("s2", "system", "s1", 102, "Generation stopped."),
        msg("a1", "assistant", "s2", 103),
        msg("u2", "user", "a1", 104),
      ])
    ).toEqual(["u1", "a1", "u2"]);
  });

  it("never shows a note saved after the last answer", () => {
    expect(
      shown([
        msg("u1", "user", ROOT_ID, 100),
        msg("a1", "assistant", "u1", 101),
        msg("s1", "system", "a1", 102, "Generation stopped."),
      ])
    ).toEqual(["u1", "a1"]);
  });

  it("puts a parent before its reply written in the same second", () => {
    const sorted = byTime([
      msg("u2", "user", "a1", 100),
      msg("a1", "assistant", "u1", 100),
    ]);

    expect(sorted.map((m) => m._eventId)).toEqual(["a1", "u2"]);
  });

  it("hides a reply until its parent arrives", () => {
    expect(shown([msg("a1b", "assistant", "u1", 102)])).toEqual([]);
  });
});

describe("titleOf", () => {
  it("is main's: the first message's text, 50 characters at most", () => {
    expect(titleOf(msg("u", "user", ROOT_ID, 1, "  hello  "))).toBe("hello");
    expect(titleOf(msg("u", "user", ROOT_ID, 1, "x".repeat(60)))).toBe(
      `${"x".repeat(50)}...`
    );
    expect(titleOf(undefined)).toBe("New Conversation");
    expect(
      titleOf({
        ...msg("u", "user", ROOT_ID, 1),
        content: [
          { type: "text", text: "pdf text", hidden: true },
          { type: "text", text: "Read this" },
        ],
      })
    ).toBe("Read this");
  });
});
