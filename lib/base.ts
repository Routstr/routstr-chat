/** Where this build is served on its origin: "" at the root, "/v2" while main
 *  keeps the root (NEXT_PUBLIC_BASE_PATH at build time). Next adds it to its
 *  own links, router and assets; every other absolute path goes through
 *  withBase. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const withBase = (path: `/${string}`) => `${BASE}${path}`;
