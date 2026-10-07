import { describe, expect, it } from "vitest";
import { TEXT_ONLY, refusal } from "./useAttachments";

const png = { type: "image/png", size: 1000 };
const pdf = { type: "application/pdf", size: 1000 };

describe("refusal: which files a draft takes", () => {
  it("takes pictures only when the model reads them, PDFs always", () => {
    expect(refusal(png, "pick", true)).toBeNull();
    expect(refusal(png, "drop", false)).toBe(TEXT_ONLY);
    expect(refusal(png, "paste", false)).toBe(TEXT_ONLY);
    expect(refusal(pdf, "pick", false)).toBeNull();
  });

  it("keeps the old rules: no SVG, no pasted PDF, nothing else, 10 MB each", () => {
    expect(refusal({ type: "image/svg+xml", size: 10 }, "pick", true)).toBe("SVG is not supported");
    expect(refusal(pdf, "paste", true)).toBe("Only images and PDFs");
    expect(refusal({ type: "text/plain", size: 10 }, "drop", true)).toBe("Only images and PDFs");
    expect(refusal({ type: "image/png", size: 11 * 1024 * 1024 }, "pick", true)).toBe("Over 10 MB");
  });
});
