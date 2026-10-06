import type { Message, MessageContent } from "@/types/chat";
import type { ApiMessage, Attachments, FileStore } from "./ports";

type ApiPart = Exclude<ApiMessage["content"], string>[number];

/** Saved in place of a message whose only files could not be kept. */
export const NOT_KEPT = "This attachment could not be kept.";

const fileOf = (part: MessageContent) =>
  part.type === "image_url"
    ? part.image_url
    : part.type === "file"
      ? part.file
      : undefined;

/**
 * A message's files over the file store. History keeps only where each file
 * is; a request loads them, and nothing is held once it is sent.
 */
export function createAttachments(files: FileStore): Attachments {
  async function toApi(
    part: MessageContent,
    signal: AbortSignal
  ): Promise<ApiPart | undefined> {
    if (part.type === "text") {
      return typeof part.text === "string"
        ? { type: "text", text: part.text }
        : undefined;
    }
    const file = fileOf(part);
    const url = file && (file.url || (await files.load(file, signal)));
    if (!url) return undefined;
    if (part.type === "image_url")
      return { type: "image_url", image_url: { url } };
    const { name, mimeType, size } = part.file!;
    return { type: "file", file: { url, name, mimeType, size } };
  }

  async function keep(
    part: MessageContent,
    signal: AbortSignal
  ): Promise<MessageContent | undefined> {
    const file = fileOf(part);
    if (!file?.url?.startsWith("data:")) return part;
    const copies =
      file.storageId || file.blossomHash
        ? {}
        : await files.store(file.url, signal);
    const kept = { ...file, ...copies, url: "" };
    if (!kept.storageId && !kept.blossomHash) return undefined;
    // the part's own field: image_url or file
    return { ...part, [part.type]: kept };
  }

  return {
    forRequest: (history, signal) =>
      Promise.all(
        history.map(async ({ role, content }) => {
          if (typeof content === "string") return { role, content };
          const parts = await Promise.all(
            content.map((part) => toApi(part, signal))
          );
          const loaded = parts.filter((part) => part !== undefined);
          return { role, content: loaded.length ? loaded : "" };
        })
      ),

    async forSave(message: Message, signal) {
      if (typeof message.content === "string") return message;
      const parts = await Promise.all(
        message.content.map((part) => keep(part, signal))
      );
      const kept = parts.filter((part) => part !== undefined);
      return { ...message, content: kept.length ? kept : NOT_KEPT };
    },
  };
}
