import { describe, expect, it } from "vitest";
import type { MessageAttachment } from "@/types/chat";
import { editedOf, questionOf } from "../question";

const image: MessageAttachment = { id: "i", type: "image", name: "cat.png", mimeType: "image/png", size: 10, dataUrl: "data:image/png;base64,AA", storageId: "s1" };
const pdf: MessageAttachment = { id: "p", type: "file", name: "plan.pdf", mimeType: "application/pdf", size: 20, dataUrl: "data:application/pdf;base64,BB", textContent: "page one" };

describe("questionOf: a question as main saves it", () => {
  it("is plain text when nothing is attached", () => {
    expect(questionOf("hello", [])).toBe("hello");
  });

  it("puts the words first, then each file, with a PDF's text after it for the model only", () => {
    expect(questionOf("look", [image, pdf])).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: image.dataUrl, storageId: "s1", blossomHash: undefined, blossomServers: undefined } },
      {
        type: "file",
        file: { url: pdf.dataUrl, storageId: undefined, blossomHash: undefined, blossomServers: undefined, name: "plan.pdf", mimeType: "application/pdf", size: 20 },
      },
      { type: "text", text: "PDF attachment (plan.pdf):\n\npage one", hidden: true },
    ]);
  });

  it("leaves out empty words", () => {
    expect(questionOf("  ", [image])).toEqual([expect.objectContaining({ type: "image_url" })]);
  });
});

describe("editedOf: new words, the same files", () => {
  it("replaces plain text", () => {
    expect(editedOf("old", "new")).toBe("new");
  });

  it("replaces only the words you see and keeps files and their hidden text", () => {
    const content = questionOf("old", [pdf]);
    const edited = editedOf(content, "new");
    expect(edited).toEqual([{ type: "text", text: "new" }, ...(content as unknown[]).slice(1)]);
  });

  it("adds the words in front when the question had none", () => {
    const content = questionOf("", [image]);
    expect(editedOf(content, "new")).toEqual([{ type: "text", text: "new" }, ...(content as unknown[])]);
  });
});
