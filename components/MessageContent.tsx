"use client";

import { useState, useEffect, useRef } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import { downloadImageFromSrc } from "../utils/download";
import { FileText } from "lucide-react";
import type { MessageContent as ChatMessageContent } from "@/types/chat";
import { getFile, saveFile } from "@/utils/indexedDb";
import SourcesDropdown from "./SourcesDropdown";
import { useBlossomSync } from "@/hooks/useBlossomSync";
import { usePnsKeys } from "@/hooks/usePnsKeys";
import { storeStorageIdMapping } from "@/utils/storageUtils";

interface MessageContentProps {
  content: string | ChatMessageContent[];
  citations?: string[];
  annotations?: import("@/types/chat").AnnotationData[];
}

/**
 * Extracts the domain from a URL, including subdomains (but removes www.)
 * @param url The URL to extract domain from
 * @returns The domain (e.g., "google.com" from "https://www.google.com")
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;
    // Remove www. prefix if present
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }
    return hostname;
  } catch {
    return url;
  }
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
      const domain = extractDomain(url);
      return `[${domain}](${url})`;
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

function getImageDedupKey(item: ChatMessageContent, index: number): string {
  const url = item.image_url?.url;
  const storageId = item.image_url?.storageId;
  const blossomHash = item.image_url?.blossomHash;

  if (url) return `url:${url}`;
  if (storageId) return `storage:${storageId}`;
  if (blossomHash) return `blossom:${blossomHash}`;
  return `index:${index}`;
}

function dedupeImageContent(items: ChatMessageContent[]): ChatMessageContent[] {
  const seen = new Set<string>();
  const deduped: ChatMessageContent[] = [];
  let imageIndex = 0;

  for (const item of items) {
    if (item.type !== "image_url") continue;
    const key = getImageDedupKey(item, imageIndex);
    imageIndex += 1;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
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

  // Blossom sync for cross-device image loading
  const { fetchFromBlossom, blossomSyncEnabled } = useBlossomSync();
  const { pnsKeys } = usePnsKeys();

  const setImageStatus = (key: string, status: ImageStatus) => {
    setImageStatusMap((prev) => {
      if (prev[key] === status) return prev;
      return { ...prev, [key]: status };
    });
  };

  const isImageLoaded = (key: string) => imageStatusMap[key] === "loaded";
  const isImageError = (key: string) => imageStatusMap[key] === "error";

  // Effect to load images from IndexedDB or Blossom if needed
  useEffect(() => {
    if (typeof content === "string") return;

    const loadImages = async () => {
      const imageItems = content.filter((item) => item.type === "image_url");

      for (const item of imageItems) {
        if (!item.image_url) continue;

        const { url, storageId, blossomHash, blossomServers } = item.image_url;

        // If we have a URL, we don't need to load from DB
        if (url && url.length > 0) continue;

        // Create a unique key for this image
        const loadKey = storageId || blossomHash;
        if (!loadKey) continue;

        // Check if we already have this image loaded
        if (blobUrls[loadKey]) {
          continue;
        }

        // Try IndexedDB first if we have storageId (only attempt once)
        if (storageId && !loadedImagesRef.current.has(`idb-${storageId}`)) {
          loadedImagesRef.current.add(`idb-${storageId}`);
          try {
            const file = await getFile(storageId);
            if (file) {
              const objectUrl = URL.createObjectURL(file);
              cleanupUrlsRef.current.push(objectUrl);
              setBlobUrls((prev) => ({ ...prev, [loadKey]: objectUrl }));
              continue;
            }
          } catch {
            // Continue to try Blossom
          }
        }

        // If IndexedDB failed or file not found, try Blossom (only if pnsKeys ready)
        if (
          blossomSyncEnabled &&
          blossomHash &&
          pnsKeys &&
          !loadedImagesRef.current.has(`blossom-${blossomHash}`)
        ) {
          loadedImagesRef.current.add(`blossom-${blossomHash}`);
          try {
            const result = await fetchFromBlossom(
              blossomHash,
              pnsKeys,
              blossomServers
            );
            if (result) {
              // Create a copy to ensure proper ArrayBuffer type
              const blobData = new Uint8Array(result.data)
                .buffer as ArrayBuffer;
              const blob = new Blob([blobData], { type: result.mimeType });
              const objectUrl = URL.createObjectURL(blob);
              cleanupUrlsRef.current.push(objectUrl);
              setBlobUrls((prev) => ({ ...prev, [loadKey]: objectUrl }));

              // Optionally save to IndexedDB for faster future access
              if (storageId) {
                try {
                  const file = new File([blob], "recovered-image", {
                    type: result.mimeType,
                  });
                  const newStorageId = await saveFile(file);
                  storeStorageIdMapping(storageId, newStorageId);
                } catch {
                  // Ignore save errors - we already have the image displayed
                }
              }
              continue; // Successfully loaded from Blossom
            }
          } catch {
            // Blossom fetch failed, will show error
          }
        }

        // Only mark as error if we've tried all available options
        // Don't mark error if pnsKeys isn't ready and we have a blossomHash
        if (
          !blossomHash ||
          (blossomHash &&
            pnsKeys &&
            loadedImagesRef.current.has(`blossom-${blossomHash}`))
        ) {
          setImageStatus(`error-${loadKey}`, "error");
        }
      }
    };

    loadImages();
  }, [content, blossomSyncEnabled, pnsKeys, fetchFromBlossom, blobUrls]);

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

  const imageContent = dedupeImageContent(content);

  // Separate text, image, and file content
  const textContent = content.filter(
    (item) => item.type === "text" && !item.hidden
  );
  const fileContent = content.filter((item) => item.type === "file");

  // Collect all citations and annotations from items using concat to avoid argument limit issues
  let allCitations: string[] = citations ? citations.slice() : [];
  let allAnnotations: import("@/types/chat").AnnotationData[] = annotations
    ? annotations.slice()
    : [];
  for (const item of textContent) {
    if (item.citations && item.citations.length > 0) {
      allCitations = allCitations.concat(item.citations);
    }
    if (item.annotations && item.annotations.length > 0) {
      allAnnotations = allAnnotations.concat(item.annotations);
    }

    // Extract markdown links from text and add them as annotations
    if (item.text) {
      const urlRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
      let match;
      while ((match = urlRegex.exec(item.text)) !== null) {
        const [_, text, url] = match;
        allAnnotations.push({
          type: "url_citation",
          start_index: 0,
          end_index: 0,
          url: url,
          title: "",
        });
      }
    }
  }

  // Deduplicate citations (simple string deduplication)
  allCitations = Array.from(new Set(allCitations));

  // Deduplicate annotations based on unique combination of properties
  const annotationMap = new Map<
    string,
    import("@/types/chat").AnnotationData
  >();
  for (const annotation of allAnnotations) {
    const key = `${annotation.start_index}-${annotation.end_index}-${annotation.url}-${annotation.title}`;
    if (!annotationMap.has(key)) {
      annotationMap.set(key, annotation);
    }
  }
  allAnnotations = Array.from(annotationMap.values());

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
            const blossomHash = item.image_url?.blossomHash;
            // Use direct URL if available, otherwise try blob URL from storageId or blossomHash
            const loadKey = storageId || blossomHash;
            const imageUrl =
              item.image_url?.url || (loadKey ? blobUrls[loadKey] : undefined);

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
