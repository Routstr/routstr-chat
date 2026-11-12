/* A code block an answer writes as a page (html) or a drawing (svg) can be
   shown working, in a box of its own. */

export type PageKind = "html" | "svg";

const KINDS: Record<string, PageKind> = { html: "html", htm: "html", xhtml: "html", svg: "svg" };
export const pageKind = (lang: string): PageKind | null => KINDS[lang] ?? null;

/* What the box lets the page do: run its scripts and forms, open links in a
   new tab that is boxed the same way, and hold the mouse for a game (the
   browser says so, and Esc always lets go). Without allow-same-origin it is an
   origin of its own, so it cannot read the app's storage (coins, keys, chats)
   or reach into the app; without allow-modals it cannot raise a dialog that
   reads as the app's own (a prompt asking for your key). */
export const SANDBOX = "allow-scripts allow-forms allow-popups allow-pointer-lock";

/** The key the box's height arrives under: the page's and its window's. */
export const HEIGHT = "routstrPageHeight";

// Ahead of the page: its own links resolve against the box, not the app's
// address (a "#part" link scrolls the page, where it loaded the app into the
// box); what it loads is not told the app's address; storage the box cannot
// have is kept in memory instead, so a page that saves to it still runs; and
// its height goes to the thread, which sizes the box to fit.
const BOOT =
  '<base href="about:srcdoc"><meta name="referrer" content="no-referrer"><script>(() => {' +
  'for (const k of ["localStorage", "sessionStorage"]) {' +
  "try { window[k].length; } catch {" +
  "const m = new Map();" +
  "const s = { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null," +
  " getItem: (x) => (m.has(String(x)) ? m.get(String(x)) : null), setItem: (x, v) => void m.set(String(x), String(v))," +
  " removeItem: (x) => void m.delete(String(x)), clear: () => m.clear() };" +
  "Object.defineProperty(window, k, { value: s, configurable: true }); } }" +
  `const tell = () => parent.postMessage({ ${HEIGHT}: [Math.ceil(document.documentElement.getBoundingClientRect().height), innerHeight] }, "*");` +
  "new ResizeObserver(tell).observe(document.documentElement);" +
  "})();</script>";

const DOCTYPE = /^\s*<!doctype[^>]*>/i;
const SVG_PAGE =
  "<style>html,body{margin:0}body{display:grid;place-items:center;padding:16px}svg{display:block;max-width:100%;height:auto}</style>";

/** The document the box shows: the page as written, after its doctype (a page
 *  written without one is shown in standards mode); a drawing centred on its own. */
export function pageDoc(kind: PageKind, code: string): string {
  if (kind === "svg") return `<!doctype html>${BOOT}${SVG_PAGE}${code}`;
  const d = DOCTYPE.exec(code);
  return d ? d[0] + BOOT + code.slice(d[0].length) : `<!doctype html>${BOOT}${code}`;
}

/** The saved file's name: the page's own title where it has one. */
export function pageFile(kind: PageKind, code: string): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(code)?.[1] ?? "";
  const stem = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return `${stem || (kind === "svg" ? "drawing" : "page")}.${kind}`;
}
