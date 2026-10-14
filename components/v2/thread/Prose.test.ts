import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Prose from "./Prose";
import StoredImage from "./StoredImage";

const html = (content: string) => renderToStaticMarkup(createElement(Prose, { content }));

describe("pictures in an answer", () => {
  it("does not load a picture from another server until it is asked for", () => {
    const out = html("Here: ![the harbour](https://img.example.com/h.png?q=what+you+asked)");
    expect(out).not.toContain("<img");
    expect(out).toContain('aria-label="Load the picture from img.example.com"');
  });
  it.each(["//img.example.com/p.png?leak=1", "http:img.example.com/p.png"])(
    "does not load a picture from another server written as %s either",
    (src) => {
      const out = html(`![pixel](${src})`);
      expect(out).not.toContain("<img");
      expect(out).toContain("img.example.com");
    }
  );
  it.each(["https://img.example.com/a.png", "/\\img.example.com/a.png", "https:/\\img.example.com/a.png"])(
    "does not load a picture part of an answer from another server (%s) until it is asked for",
    (url) => {
      const item = { type: "image_url", image_url: { url } };
      const out = renderToStaticMarkup(createElement(StoredImage, { item: item as never }));
      expect(out).not.toContain("<img");
    }
  );
  it("shows a picture written into the words as a data: link, as some image models answer", () => {
    const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    expect(html(`Here it is:\n\n![a red dot](${px})`)).toContain(`<img src="${px}"`);
    // a data: link to anything else is still dropped
    expect(html("[open](data:text/html,hi)")).not.toContain("data:text/html");
  });
  it("shows a picture from this app at once", () => {
    expect(html("![dot](/icons/icon-192.png)")).toContain('<img src="/icons/icon-192.png"');
  });
});
