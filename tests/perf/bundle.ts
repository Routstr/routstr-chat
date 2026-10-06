// What the browser has to download: every JS and CSS file in a static export, and what the
// home page loads before it can run (its <script> and stylesheet tags), raw and gzipped.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export interface BundleSize {
  jsBytes: number;
  jsGzip: number;
  cssGzip: number;
  homeJsGzip: number; // scripts the home page loads (old-browser polyfills left out)
  homeCssGzip: number;
}

const gzip = (file: string) =>
  zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

export function bundleSize(outDir: string): BundleSize {
  const files = walk(path.join(outDir, "_next"));
  const js = files.filter((f) => f.endsWith(".js"));
  const css = files.filter((f) => f.endsWith(".css"));
  const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
  // the tags the home page names; a noModule script only runs in browsers without modules
  const named = (tag: RegExp, attr: RegExp) =>
    [
      ...new Set(
        [...html.matchAll(tag)]
          .map((m) => m[0])
          .filter((t) => !/\bnomodule\b/i.test(t))
          .map((t) => t.match(attr)?.[1])
          .filter((src): src is string => !!src)
      ),
    ]
      .map((src) => path.join(outDir, src.split("?")[0]))
      .filter((f) => fs.existsSync(f));
  const homeJs = named(/<script[^>]*>/g, /src="([^"]+\.js[^"]*)"/);
  const homeCss = named(/<link[^>]*>/g, /href="([^"]+\.css[^"]*)"/);
  const gzipped = (list: string[]) => list.reduce((s, f) => s + gzip(f), 0);
  return {
    jsBytes: js.reduce((s, f) => s + fs.statSync(f).size, 0),
    jsGzip: gzipped(js),
    cssGzip: gzipped(css),
    homeJsGzip: gzipped(homeJs),
    homeCssGzip: gzipped(homeCss),
  };
}
