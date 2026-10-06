import { describe, expect, it } from "vitest";
import { qBlocks } from "./qBlocks";

const prose = (...lines: string[]) => ({ kind: "prose", lines, fenced: false });
const code = (...lines: string[]) => ({ kind: "code", lines, fenced: false });
const fenced = (...lines: string[]) => ({ kind: "code", lines, fenced: true });

describe("qBlocks", () => {
  it("gives nothing for an empty message", () => {
    expect(qBlocks("")).toEqual([]);
  });

  it("splits prose at blank lines", () => {
    expect(qBlocks("hello world")).toEqual([prose("hello world")]);
    expect(qBlocks("a\nb\n\n\nc")).toEqual([prose("a", "b"), prose("c")]);
  });

  it("drops carriage returns", () => {
    expect(qBlocks("one\r\ntwo\r\n\r\nthree")).toEqual([prose("one", "two"), prose("three")]);
  });

  it("keeps a fence as one code block, blank lines included", () => {
    expect(qBlocks("before\n```js\nconst a = 1;\n\nb\n```\nafter")).toEqual([prose("before"), fenced("const a = 1;", "", "b"), prose("after")]);
    expect(qBlocks("```\n\n\n```")).toEqual([fenced("", "")]);
  });

  it("runs an unclosed fence to the end", () => {
    expect(qBlocks("x\n```\ncode\nmore")).toEqual([prose("x"), fenced("code", "more")]);
  });

  it("takes an indented fence", () => {
    expect(qBlocks("  ```py\nprint(1)\n  ```")).toEqual([fenced("print(1)")]);
  });

  it("reads pasted compiler output as code", () => {
    const text = 'error[E0382]: borrow of moved value: `v`\n --> src/main.rs:4:20\n  |\n4 |     println!("{:?}", v);\n  |                    ^ value borrowed here after move';
    expect(qBlocks(text)).toEqual([
      code("error[E0382]: borrow of moved value: `v`", " --> src/main.rs:4:20", "  |", '4 |     println!("{:?}", v);', "  |                    ^ value borrowed here after move"),
    ]);
  });

  it("joins neighbouring code paragraphs with a blank line", () => {
    expect(qBlocks("fn a() {\n  x;\n}\n\nfn b() {\n  y;\n}")).toEqual([code("fn a() {", "  x;", "}", "", "fn b() {", "  y;", "}")]);
  });

  it("calls a paragraph code from 60% code-like lines", () => {
    expect(qBlocks("  a\n  b\n  c\nd\ne")).toEqual([code("  a", "  b", "  c", "d", "e")]);
    expect(qBlocks("  a\n  b\nc\nd\ne")).toEqual([prose("  a", "  b", "c", "d", "e")]);
    expect(qBlocks("Here is my code:\n  let x = 1;\nwhy does it fail?")).toEqual([prose("Here is my code:", "  let x = 1;", "why does it fail?")]);
  });

  it("knows each code-like line on its own, and half is not enough", () => {
    for (const l of ["  x", " --> a.rs:1:1", " | x", "12 | x", "})", "foo {", "a;", "error: x", "warning[W1]: x", "note: x", "help: x"])
      expect(qBlocks(l)).toEqual([code(l)]);
    expect(qBlocks("  a\nb")).toEqual([prose("  a", "b")]);
  });

  it("never joins a fence with the code around it", () => {
    expect(qBlocks("if (x) {\n  y();\n}\n```\nz\n```\nfoo {\n}")).toEqual([code("if (x) {", "  y();", "}"), fenced("z"), code("foo {", "}")]);
  });
});
