/* What a model is allowed to put on the page: only safe link and image
   schemes, and links cleaned of tracking parameters before anyone clicks. */

export const safeHref = (href?: string) => {
  if (!href) return null;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    if (["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return href;
  } catch {
    // not a URL
  }
  return null;
};

/** Whether a picture would be fetched from another server, however its address is written
 *  ("//host", "http:host", "/\\host" all are): anything but this app's own files and the
 *  pictures held in the page itself (data:, blob:). */
export const isRemote = (src: string) => {
  if (/^(data|blob):/i.test(src)) return false;
  const here = typeof location === "undefined" ? "https://app.invalid/" : location.href;
  try {
    return new URL(src, here).origin !== new URL(here).origin;
  } catch {
    return true;
  }
};

export const safeImageSrc = (src?: string | Blob) => {
  if (!src || typeof src !== "string") return null;
  if (src.startsWith("/")) return src;
  try {
    const url = new URL(src);
    if (["http:", "https:", "data:", "blob:"].includes(url.protocol)) return src;
  } catch {
    // not a URL
  }
  return null;
};

const TRACKING = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "ref", "source", "from", "via",
  "fbclid", "gclid", "dclid", "gbraid", "wbraid",
  "msclkid", "twclkid", "igshid", "mc_cid", "mc_eid",
  "_ga", "_gl", "yclid", "zanpid", "spm", "share_source",
]);

export const cleanUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
};

/** ([text](url)) reads as noise; keep the link, drop the brackets. */
export const stripParensAroundLinks = (text: string) =>
  text.replace(/\(\[([^\]]+)\]\(([^)]+)\)\)/g, "[$1]($2)");

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
