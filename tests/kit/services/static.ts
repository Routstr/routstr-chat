// Serves a static export (out/) the way `serve -s` does: the file, else <path>.html, else
// <path>/index.html, else index.html. A build with a base path (/v2) is served under it.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

export async function serveStatic(root: string, base = ""): Promise<StaticServer> {
  const resolve = (urlPath: string) => {
    const clean = path.normalize(decodeURIComponent(urlPath.split("?")[0]));
    for (const candidate of [
      clean,
      `${clean}.html`,
      path.join(clean, "index.html"),
      "index.html",
    ]) {
      const file = path.join(root, candidate);
      if (
        file.startsWith(root) &&
        fs.existsSync(file) &&
        fs.statSync(file).isFile()
      )
        return file;
    }
    return undefined;
  };
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (base && url !== base && !url.startsWith(`${base}/`) && !url.startsWith(`${base}?`))
      return res.writeHead(404).end();
    const file = resolve(url.slice(base.length) || "/");
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port: bound } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${bound}${base}`,
    close: () =>
      new Promise<void>(
        (r) => (server.closeAllConnections(), server.close(() => r()))
      ),
  };
}
