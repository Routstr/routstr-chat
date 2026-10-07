import { useCallback, useState } from "react";
import type { MessageAttachment } from "@/types/chat";
import { extractTextFromPdf } from "@/components/v2/composer/pdfUtils";
import { useFiles, useFileSync } from "@/features/chat/view";
import { useHistoryKeys } from "@/features/history/view";

/* Taking files into the composer: the same rules the old composer applied
   (images and PDFs, 10 MB each, no SVG, stored locally, PDF text extracted,
   optional encrypted Blossom upload). A refused file is said once, in the
   composer's own voice slot. */

const MAX_MB = 10;
const MAX_BYTES = MAX_MB * 1024 * 1024;

const newId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Why a file cannot be attached, or null when it can: images and PDFs (a
 *  pasted PDF is never meant), 10 MB each, no SVG, and images only when the
 *  model reads them. */
export function refusal(
  file: { type: string; size: number },
  source: "pick" | "paste" | "drop",
  images: boolean
): string | null {
  const isImage = file.type.startsWith("image/");
  if (file.type === "image/svg+xml") return "SVG is not supported";
  if (!isImage && !(file.type === "application/pdf" && source !== "paste")) return "Only images and PDFs";
  if (isImage && !images) return TEXT_ONLY;
  if (file.size > MAX_BYTES) return `Over ${MAX_MB} MB`;
  return null;
}

/** What is said when a text-only model is offered a picture. */
export const TEXT_ONLY = "This model reads text only";

const toDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

export function useAttachments(
  setAttachments: React.Dispatch<React.SetStateAction<MessageAttachment[]>>,
  say: (problem: string) => void,
  images: boolean
) {
  // PDFs whose text is still being read
  const [reading, setReading] = useState<ReadonlySet<string>>(new Set());
  const store = useFiles();
  const [{ on: blossomSyncEnabled }] = useFileSync();
  const pnsKeys = useHistoryKeys();

  const patch = useCallback(
    (id: string, fn: (a: MessageAttachment) => MessageAttachment) =>
      setAttachments((prev) => prev.map((a) => (a.id === id ? fn(a) : a))),
    [setAttachments]
  );

  const addFiles = useCallback(
    async (files: File[] | FileList, source: "pick" | "paste" | "drop") => {
      const list = Array.from(files);
      const built: { attachment: MessageAttachment; file: File; pdf: boolean }[] = [];

      for (const file of list) {
        const isImage = file.type.startsWith("image/");
        const isPdf = file.type === "application/pdf";
        const no = refusal(file, source, images);
        if (no) {
          // a paste of something else (text, a link) is not an attachment at all
          if (!(no === "Only images and PDFs" && source === "paste")) say(no);
          continue;
        }
        try {
          const dataUrl = await toDataUrl(file);
          const storageId = await store?.keep(dataUrl);
          if (store && !storageId) say("Storage full, may not be kept");
          const name =
            file.name || `pasted-image-${Date.now()}.${file.type.split("/")[1] ?? "png"}`;
          built.push({
            file,
            pdf: isPdf,
            attachment: {
              id: newId(),
              name,
              mimeType: file.type,
              size: file.size,
              dataUrl,
              type: isImage ? "image" : "file",
              storageId,
              blossomUploadStatus: blossomSyncEnabled && pnsKeys ? "uploading" : undefined,
            },
          });
        } catch (error) {
          console.error("Could not read attachment", error);
        }
      }

      if (!built.length) return;
      setAttachments((prev) => [...prev, ...built.map((b) => b.attachment)]);

      for (const { attachment, file, pdf } of built) {
        if (pdf) {
          setReading((r) => new Set(r).add(attachment.id));
          extractTextFromPdf(file)
            .then((text) => {
              if (text.trim()) patch(attachment.id, (a) => ({ ...a, textContent: text }));
            })
            .catch((e) => console.warn("PDF text extraction failed, sending without text.", e))
            .finally(() =>
              setReading((r) => {
                const n = new Set(r);
                n.delete(attachment.id);
                return n;
              })
            );
        }
        if (store && blossomSyncEnabled && pnsKeys) {
          // copy() never rejects; it names only the copies made
          void store
            .copy(attachment.dataUrl, new AbortController().signal)
            .then((copies) =>
              patch(attachment.id, (a) =>
                copies.blossomHash
                  ? { ...a, ...copies, blossomUploadStatus: "success" }
                  : { ...a, blossomUploadStatus: "failed" }
              )
            );
        }
      }
    },
    [store, blossomSyncEnabled, pnsKeys, patch, setAttachments, say, images]
  );

  const remove = useCallback(
    (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id)),
    [setAttachments]
  );

  return { addFiles, remove, reading };
}
