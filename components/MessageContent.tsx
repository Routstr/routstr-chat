"use client";

import { useState, useEffect, useRef } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import { downloadImageFromSrc } from "../utils/download";
import { FileText } from "lucide-react";
import type { MessageContent as ChatMessageContent } from "@/types/chat";
import { getFile } from "@/utils/indexedDb";
import SourcesDropdown from "./SourcesDropdown";

interface MessageContentProps {
  content: string | ChatMessageContent[];
  citations?: string[];
  annotations?: import("@/types/chat").AnnotationData[];
}

/**
 * Processes text content to replace citation markers [1], [2], etc. with markdown links
 * @param text The text content with citation markers
 * @param citations Array of citation URLs
 * @returns Processed text with markdown links
 */
function processCitations(text: string, citations?: string[]): string {
  if (!citations || citations.length === 0) {
    return text;
  }

  // Replace citation markers [1], [2], etc. with markdown links
  return text.replace(/\[(\d+)\]/g, (match, num) => {
    const index = parseInt(num, 10) - 1;
    if (index >= 0 && index < citations.length) {
      const url = citations[index];
      return `[[${num}]](${url})`;
    }
    return match; // Return original if citation not found
  });
}

/**
 * Processes text content to replace annotated text ranges with markdown links
 * @param text The text content
 * @param annotations Array of annotation objects with start_index, end_index, url, and title
 * @returns Processed text with markdown links
 */
function processAnnotations(
  text: string,
  annotations?: import("@/types/chat").AnnotationData[]
): string {
  if (!annotations || annotations.length === 0) {
    return text;
  }

  // Sort annotations by start_index in descending order to process from end to start
  // This prevents index shifting issues when replacing text
  const sortedAnnotations = [...annotations].sort(
    (a, b) => b.start_index - a.start_index
  );

  let result = text;
  for (const annotation of sortedAnnotations) {
    const { start_index, end_index, url, title } = annotation;

    // Extract the text to be replaced
    const annotatedText = result.substring(start_index, end_index);

    // Create markdown link with title as hover text
    const markdownLink = `[${annotatedText}](${url} "${title}")`;

    // Replace the text range with the markdown link
    result =
      result.substring(0, start_index) +
      markdownLink +
      result.substring(end_index);
  }

  return result;
}

export default function MessageContentRenderer({
  content,
  citations,
  annotations,
}: MessageContentProps) {
  type ImageStatus = "loading" | "loaded" | "error";
  const [imageStatusMap, setImageStatusMap] = useState<
    Record<string, ImageStatus>
  >({});
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const loadedImagesRef = useRef<Set<string>>(new Set());
  const cleanupUrlsRef = useRef<string[]>([]);

  const setImageStatus = (key: string, status: ImageStatus) => {
    setImageStatusMap((prev) => {
      if (prev[key] === status) return prev;
      return { ...prev, [key]: status };
    });
  };

  const isImageLoaded = (key: string) => imageStatusMap[key] === "loaded";
  const isImageError = (key: string) => imageStatusMap[key] === "error";

  // Effect to load images from IndexedDB if needed
  useEffect(() => {
    if (typeof content === "string") return;

    const loadImages = async () => {
      // console.log(content);
      const imageItems = content.filter((item) => item.type === "image_url");

      for (const item of imageItems) {
        if (!item.image_url) continue;

        const { url, storageId } = item.image_url;

        // If we have a URL, we don't need to load from DB
        if (url && url.length > 0) continue;

        // If we have a storageId but no URL, and haven't loaded it yet
        if (storageId && !loadedImagesRef.current.has(storageId)) {
          // Mark as loaded immediately to prevent double-loading in Strict Mode
          loadedImagesRef.current.add(storageId);

          try {
            const file = await getFile(storageId);
            if (file) {
              const objectUrl = URL.createObjectURL(file);
              cleanupUrlsRef.current.push(objectUrl);
              setBlobUrls((prev) => ({ ...prev, [storageId]: objectUrl }));
            } else {
              // File not found - mark as error so user sees feedback
              setImageStatus(`error-${storageId}`, "error");
            }
          } catch (error) {
            // Error loading file - mark as error
            setImageStatus(`error-${storageId}`, "error");
            console.warn(
              `Failed to load file from storage (ID: ${storageId}):`,
              error instanceof Error ? error.message : "Unknown error"
            );
          }
        }
      }
    };

    loadImages();
  }, [content]);

  // Cleanup object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      cleanupUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch (error) {
          // Ignore revocation errors
        }
      });
      loadedImagesRef.current.clear();
    };
  }, []);

  if (typeof content === "string") {
    let processedContent = processAnnotations(content, annotations);
    processedContent = processCitations(processedContent, citations);
    return (
      <>
        <MarkdownRenderer content={processedContent} />
        <SourcesDropdown citations={citations} annotations={annotations} />
      </>
    );
  }

  const getAttachmentLabel = (mimeType?: string): string | null => {
    if (!mimeType) return null;
    if (mimeType === "application/pdf") return "PDF";
    if (mimeType.startsWith("image/")) {
      return mimeType.replace("image/", "").toUpperCase();
    }
    return mimeType.toUpperCase();
  };

  const imageContent = content.filter((item) => item.type === "image_url");

  // Separate text, image, and file content
  const textContent = content.filter(
    (item) => item.type === "text" && !item.hidden
  );
  const fileContent = content.filter((item) => item.type === "file");

  // Collect all citations and annotations from items
  const allCitations = citations || [];
  const allAnnotations = annotations || [];
  textContent.forEach((item) => {
    if (item.citations) {
      allCitations.push(...item.citations);
    }
    if (item.annotations) {
      allAnnotations.push(...item.annotations);
    }
  });

  return (
    <div className="space-y-2">
      {/* Render text content first */}
      {textContent.map((item, index) => {
        // Use citations and annotations from the item itself, or fall back to the prop
        const itemCitations = item.citations || citations;
        const itemAnnotations = item.annotations || annotations;
        let processedText = processAnnotations(
          item.text || "",
          itemAnnotations
        );
        processedText = processCitations(processedText, itemCitations);
        return (
          <MarkdownRenderer key={`text-${index}`} content={processedText} />
        );
      })}

      {/* Render file attachments */}
      {fileContent.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileContent.map((item, index) => {
            const label = getAttachmentLabel(item.file?.mimeType);
            return (
              <div
                key={`file-${index}`}
                className="flex w-[220px] max-w-full h-16 items-center gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2"
              >
                <FileText
                  className="h-5 w-5 text-foreground/80 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium text-foreground"
                    title={item.file?.name || "Attachment"}
                  >
                    {item.file?.name || "Attachment"}
                  </p>
                  {label && (
                    <p className="text-xs uppercase text-muted-foreground">
                      {label}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Render images in a flex container */}
      {imageContent.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {imageContent.map((item, index) => {
            const storageId = item.image_url?.storageId;
            // Use direct URL if available, otherwise try blob URL from storageId
            const imageUrl =
              item.image_url?.url ||
              (storageId ? blobUrls[storageId] : undefined);

            const statusKey = `${index}-${imageUrl ?? "no-url"}`;
            const loaded = isImageLoaded(statusKey);
            const errored = isImageError(statusKey);

            return (
              <div
                key={`image-${index}`}
                className={`relative group shrink-0 overflow-hidden rounded-xl border border-border bg-muted/50`}
                style={{
                  width: "min(320px, 100%)",
                  aspectRatio: loaded ? undefined : "1 / 1",
                }}
              >
                <div
                  className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
                    loaded || errored
                      ? "opacity-0 pointer-events-none"
                      : "opacity-100"
                  }`}
                >
                  <div className="absolute inset-0 animate-pulse bg-linear-to-br from-muted via-muted/50 to-transparent" />
                  <div className="relative h-10 w-10 rounded-full border-2 border-foreground/40 border-t-transparent animate-spin" />
                </div>
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt="Image"
                    onLoad={() => setImageStatus(statusKey, "loaded")}
                    onError={() => setImageStatus(statusKey, "error")}
                    className={`block max-w-[320px] w-full h-full max-h-[360px] object-contain bg-black/40 transition-opacity duration-300 ${
                      loaded ? "opacity-100" : "opacity-0"
                    }`}
                  />
                )}
                {errored && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-xs p-4 text-center">
                    Image failed to load
                  </div>
                )}
                <button
                  type="button"
                  disabled={!loaded || !imageUrl}
                  onClick={() => imageUrl && downloadImageFromSrc(imageUrl)}
                  className={`absolute top-3 right-3 transition-opacity bg-card hover:bg-muted text-foreground text-xs rounded-md px-2 py-1 border border-border ${
                    loaded
                      ? "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      : "opacity-0 pointer-events-none"
                  }`}
                  aria-label="Download image"
                >
                  Download
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Sources dropdown */}
      <SourcesDropdown citations={allCitations} annotations={allAnnotations} />
    </div>
  );
}
