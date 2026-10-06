import { describe, expect, it } from "vitest";
import type { AnnotationData, Message } from "@/types/chat";
import { parseContent } from "./content";

const reply = (text: string, annotations: Partial<AnnotationData>[]): Message["content"] => [
  { type: "text", text, annotations: annotations as AnnotationData[] },
];

describe("parseContent: url_citation annotations", () => {
  it("keeps a link the model already wrote, and lists its source", () => {
    const text = "Read [the docs](https://docs.example/x) first.";
    const parsed = parseContent(reply(text, [{ type: "url_citation", start_index: 5, end_index: 39, url: "https://docs.example/x", title: "Docs" }]));
    expect(parsed.text).toBe(text);
    expect(parsed.sources).toEqual([{ url: "https://docs.example/x", title: "Docs" }]);
  });

  it("shows the reply once when a source has no indices", () => {
    const text = "Ecash is private by default.";
    const parsed = parseContent(reply(text, [{ type: "url_citation", url: "https://cashu.space/", title: "Cashu" }]));
    expect(parsed.text).toBe(text);
    expect(parsed.sources).toEqual([{ url: "https://cashu.space/", title: "Cashu" }]);
  });

  it("lists a source cited twice once, and leaves both cited spans as written", () => {
    const text = "Mints sign blinded points. Wallets unblind them.";
    const parsed = parseContent(
      reply(text, [
        { type: "url_citation", start_index: 0, end_index: 25, url: "https://cashu.space/", title: "Cashu" },
        { type: "url_citation", start_index: 27, end_index: 47, url: "https://cashu.space/", title: "Cashu" },
      ])
    );
    expect(parsed.text).toBe(text);
    expect(parsed.sources).toEqual([{ url: "https://cashu.space/", title: "Cashu" }]);
  });

  it("does not nest a citation marker inside an annotation link", () => {
    const text = "See [1].";
    const parsed = parseContent(reply(text, [{ type: "url_citation", start_index: 4, end_index: 7, url: "https://a.example/", title: "A" }]));
    expect(parsed.text).toBe(text);
    expect(parsed.sources).toEqual([{ url: "https://a.example/", title: "A" }]);
  });
});
