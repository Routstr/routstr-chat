import type { Message } from "@/types/chat";

/* The request a send would make, in the shape the SDK prices it: the chat's
   branch and the question, each message on its own, as attachments.forRequest
   sends them. A picture or file goes as a stand-in of its data's length: the
   provider counts a data: URL as words, and the SDK would read a real one's
   pixels on every call. */

// "data:image/jpeg;base64,", the longest usual picture type: a saved picture keeps none
const PICTURE_HEADER = 23;
const dataLength = (size: number, header: number) =>
  header + 4 * Math.ceil(size / 3);

let pad = "";
/** `n` characters, sliced from one string so no data is copied per call. */
function standIn(n: number): string {
  if (pad.length < n) pad = "x".repeat(Math.max(n, pad.length * 2));
  return pad.slice(0, n);
}

/** Null when a saved file's size is unknown: it may be any size. */
function pricedContent(
  content: Message["content"],
  images: boolean
): unknown | null {
  if (typeof content === "string") return content;
  const parts: unknown[] = [];
  for (const part of content) {
    if (part.type === "text") {
      if (typeof part.text === "string")
        parts.push({ type: "text", text: part.text });
      continue;
    }
    const picture = part.type === "image_url";
    const file = picture ? part.image_url : part.file;
    // nothing to load: the request leaves it out
    if (!file || (!file.url && !file.storageId && !file.blossomHash)) continue;
    if (picture && !images) continue;
    const header = picture
      ? PICTURE_HEADER
      : `data:${part.file?.mimeType ?? ""};base64,`.length;
    const length = file.url
      ? file.url.length
      : file.size !== undefined
        ? dataLength(file.size, header)
        : undefined;
    if (length === undefined) return null;
    if (picture) {
      parts.push({ type: "image_url", image_url: { url: standIn(length) } });
    } else {
      const { name, mimeType, size } = part.file!;
      parts.push({
        type: "file",
        file: { url: standIn(length), name, mimeType, size },
      });
    }
  }
  return parts.length ? parts : "";
}

/** The messages a send of `question` after `branch` would carry (the SDK
 *  sends no system note); `images` false for a model that reads text only
 *  (its pictures are left out). Null when a saved file's size is unknown. */
export function pricedRequest(
  branch: Message[],
  question: Message["content"],
  images: boolean
): unknown[] | null {
  const messages: unknown[] = [];
  for (const { role, content } of [
    ...branch,
    { role: "user", content: question },
  ]) {
    if (role === "system") continue;
    const priced = pricedContent(content, images);
    if (priced === null) return null;
    messages.push({ role, content: priced });
  }
  return messages;
}
