import { describe, expect, it } from "vitest";
import type { MessageAttachment } from "@/types/chat";
import { attached, cleared, typed, type DraftState } from "./ui";

const empty: DraftState = { text: "", attachments: [], rev: 0 };
const file = { name: "a.png" } as MessageAttachment;

describe("the draft", () => {
  it("counts every change, words or files", () => {
    const d = attached(typed(empty, "hi"), [file]);
    expect(d).toEqual({ text: "hi", attachments: [file], rev: 2 });
    expect(attached(d, (fs) => fs.slice(1)).attachments).toEqual([]);
  });

  it("a send empties the box only if nothing changed since it read the draft", () => {
    const sent = typed(empty, "first question");
    expect(cleared(sent, sent.rev)).toMatchObject({ text: "", attachments: [] });
    // the same words typed again after the send read them still count as new
    const retyped = typed(typed(sent, ""), "first question");
    expect(cleared(retyped, sent.rev)).toBe(retyped);
  });
});
