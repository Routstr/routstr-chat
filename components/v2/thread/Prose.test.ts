import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Prose from "./Prose";

const html = (content: string) => renderToStaticMarkup(createElement(Prose, { content }));

describe("pictures in an answer", () => {
  it("does not load a picture from another server until it is asked for", () => {
    const out = html("Here: ![the harbour](https://img.example.com/h.png?q=what+you+asked)");
    expect(out).not.toContain("<img");
    expect(out).toContain('aria-label="Load the picture from img.example.com"');
  });
  it("shows a picture from this app at once", () => {
    expect(html("![dot](/icons/icon-192.png)")).toContain('<img src="/icons/icon-192.png"');
  });
});
