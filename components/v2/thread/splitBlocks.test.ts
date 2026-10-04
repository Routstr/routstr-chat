import { describe, expect, it } from "vitest";
import { splitBlocks } from "./splitBlocks";

describe("splitBlocks", () => {
  it("splits paragraphs at blank lines", () => {
    expect(splitBlocks("one\n\ntwo\n\n\nthree")).toEqual(["one", "two", "three"]);
  });

  it("never splits inside a code fence", () => {
    const md = "before\n\n```py\na = 1\n\nb = 2\n```\n\nafter";
    expect(splitBlocks(md)).toEqual(["before", "```py\na = 1\n\nb = 2\n```", "after"]);
  });

  it("keeps an unclosed fence (still streaming) as one block", () => {
    const md = "intro\n\n```js\nconst a = 1;\n\nconst b";
    expect(splitBlocks(md)).toEqual(["intro", "```js\nconst a = 1;\n\nconst b"]);
  });

  it("never splits inside display math", () => {
    const md = "x\n\n$$\na = b\n\nc = d\n$$\n\ny";
    expect(splitBlocks(md)).toEqual(["x", "$$\na = b\n\nc = d\n$$", "y"]);
  });

  it("keeps a loose list together", () => {
    const md = "1. first\n\n2. second\n\nafter";
    expect(splitBlocks(md)).toEqual(["1. first\n\n2. second", "after"]);
  });

  it("keeps an indented continuation with its list item", () => {
    const md = "- item\n\n    more of the item\n\nnext";
    expect(splitBlocks(md)).toEqual(["- item\n\n    more of the item", "next"]);
  });
});
