import type { Message, MessageContent } from "@/types/chat";
import { hostOf } from "./links";

export interface Parsed {
  text: string;
  thinking: string;
  images: MessageContent[];
  files: MessageContent[];
  sources: { url: string; title: string }[];
}

/** [1] markers become links to their citation, labelled by host. */
function applyCitations(text: string, citations?: string[]) {
  if (!citations?.length) return text;
  return text.replace(/\[(\d+)\]/g, (m, n) => {
    const url = citations[Number(n) - 1];
    return url ? `[${n}](${url})` : m;
  });
}

const imageKey = (c: MessageContent, i: number) =>
  c.image_url?.url
    ? `u:${c.image_url.url.slice(0, 64)}${c.image_url.url.length}`
    : c.image_url?.storageId
      ? `s:${c.image_url.storageId}`
      : c.image_url?.blossomHash
        ? `b:${c.image_url.blossomHash}`
        : `i:${i}`;

export function parseContent(content: Message["content"]): Parsed {
  if (typeof content === "string") {
    return { text: content, thinking: "", images: [], files: [], sources: [] };
  }
  const texts = content.filter((c) => c.type === "text" && !c.hidden);
  const seen = new Set<string>();
  const images = content.filter((c, i) => {
    if (c.type !== "image_url") return false;
    const k = imageKey(c, i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const files = content.filter((c) => c.type === "file");
  const sources = new Map<string, string>();
  let thinking = "";
  const parts = texts.map((t) => {
    if (t.thinking && !thinking) thinking = t.thinking;
    t.citations?.forEach((u) => sources.set(u, hostOf(u)));
    // annotations only list sources: the reply reads as the model wrote it, its own links included
    t.annotations?.forEach((a) => sources.set(a.url, a.title || hostOf(a.url)));
    let s = applyCitations(t.text ?? "", t.citations);
    // image models write "<image>" where the picture goes; the picture renders itself
    if (images.length) s = s.replace(/<image>/gi, "").trim();
    return s;
  });
  return {
    text: parts.filter(Boolean).join("\n\n"),
    thinking: cleanThinking(thinking),
    images,
    files,
    sources: [...sources].map(([url, title]) => ({ url, title })),
  };
}

/** A message's own words: the text, or its first shown text part. */
export const textOf = (content: Message["content"]) =>
  typeof content === "string" ? content : (content.find((c) => c.type === "text" && !c.hidden)?.text ?? "");

/** The SDK wraps reasoning in literal <thinking> markers. */
export const cleanThinking = (s: string) =>
  s.replace(/<\/?thinking>\s?/g, "").replace(/^\s+/, "");

/** A short name for what the reasoning was about: its first heading or line. */
export function thinkingTopic(s: string) {
  const lines = cleanThinking(s).split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.find((l) => /^(#{1,4}\s|\*\*[^*]+\*\*$)/.test(l));
  return (head ?? "").replace(/^#+\s*/, "").replace(/\*\*/g, "").slice(0, 80);
}
