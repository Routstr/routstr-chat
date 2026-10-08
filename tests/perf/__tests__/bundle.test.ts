import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleSize } from "../bundle";

/** an export whose home page names its script and style under `base` */
function exportAt(base: string) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  fs.mkdirSync(path.join(out, "_next/static"), { recursive: true });
  fs.writeFileSync(
    path.join(out, "_next/static/app.js"),
    "console.log('app');".repeat(20)
  );
  fs.writeFileSync(
    path.join(out, "_next/static/app.css"),
    "body{color:red}".repeat(20)
  );
  fs.writeFileSync(
    path.join(out, "index.html"),
    `<link rel="stylesheet" href="${base}/_next/static/app.css"><script src="${base}/_next/static/app.js"></script>`
  );
  return out;
}

describe("bundleSize", () => {
  it("weighs the home page's files the same at the root and under a sub-path", () => {
    const root = bundleSize(exportAt(""));
    const sub = bundleSize(exportAt("/v2"));
    expect(root.homeJsGzip).toBeGreaterThan(0);
    expect(sub.homeJsGzip).toBe(root.homeJsGzip);
    expect(sub.homeCssGzip).toBe(root.homeCssGzip);
  });
});
