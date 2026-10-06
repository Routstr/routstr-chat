import type { Message, MessageAttachment, MessageContent } from "@/types/chat";

/** What you wrote and attached, as main saves a question: the words, then each
 *  image or file, a PDF's text after it for the model only. */
export function questionOf(
  text: string,
  attachments: MessageAttachment[]
): Message["content"] {
  if (!attachments.length) return text;
  const parts: MessageContent[] = text.trim() ? [{ type: "text", text }] : [];
  for (const a of attachments) {
    const stored = {
      url: a.dataUrl,
      storageId: a.storageId,
      blossomHash: a.blossomHash,
      blossomServers: a.blossomServers,
    };
    if (a.type === "image") {
      parts.push({ type: "image_url", image_url: stored });
      continue;
    }
    parts.push({
      type: "file",
      file: { ...stored, name: a.name, mimeType: a.mimeType, size: a.size },
    });
    if (a.textContent?.trim()) {
      parts.push({
        type: "text",
        text: `PDF attachment (${a.name}):\n\n${a.textContent}`,
        hidden: true,
      });
    }
  }
  return parts.length ? parts : "";
}

/** A question with its words changed; its files and their text stay. */
export function editedOf(
  content: Message["content"],
  text: string
): Message["content"] {
  if (typeof content === "string") return text;
  let replaced = false;
  const parts = content.flatMap((part) => {
    if (part.type !== "text" || part.hidden) return [part];
    if (replaced) return [];
    replaced = true;
    return [{ ...part, text }];
  });
  return replaced ? parts : [{ type: "text", text }, ...parts];
}
