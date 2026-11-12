import { describe, expect, it } from "vitest";
import { pageDoc, pageFile, pageKind } from "./pageDoc";

describe("pageDoc", () => {
  it("previews html and svg blocks only", () => {
    expect(["html", "htm", "xhtml", "svg"].map(pageKind)).toEqual(["html", "html", "html", "svg"]);
    expect(["xml", "js", "", "markdown"].map(pageKind)).toEqual([null, null, null, null]);
  });

  it("keeps a page's own doctype first, so it is not drawn in quirks mode", () => {
    const doc = pageDoc("html", "<!DOCTYPE html>\n<html><body>hi</body></html>");
    expect(doc.startsWith("<!DOCTYPE html><base href=\"about:srcdoc\">")).toBe(true);
    expect(doc.endsWith("\n<html><body>hi</body></html>")).toBe(true);
  });

  it("gives a page written without a doctype one", () => {
    expect(pageDoc("html", "<p>hi</p>").startsWith("<!doctype html><base")).toBe(true);
  });

  it("names the saved file after the page's title", () => {
    expect(pageFile("html", "<title>  Sats & Tips: a Calculator! </title>")).toBe("sats-tips-a-calculator.html");
    expect(pageFile("html", "<p>no title</p>")).toBe("page.html");
    expect(pageFile("svg", "<svg></svg>")).toBe("drawing.svg");
  });
});
