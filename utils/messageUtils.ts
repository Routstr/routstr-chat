import { Message, MessageAttachment, MessageContent } from "@/types/chat";
import { getFile } from "@/utils/indexedDb";

/**
 * Extracts text content from a message that can be either string or multimodal content
 * @param content The message content (string or MessageContent array)
 * @returns The text content as a string
 */
export const getTextFromContent = (
  content: string | MessageContent[],
): string => {
  if (typeof content === "string") return content;

  try {
    const textContent = content.find(
      (item) => item.type === "text" && !item.hidden,
    );
    return textContent?.text || "";
  } catch (error) {
    // Check if content is an error object with the expected structure
    if (
      typeof content === "object" &&
      content !== null &&
      "error" in content &&
      "request_id" in content
    ) {
      const errorObj = content as any;
      const errorMessage = errorObj.error?.message || "Unknown error";
      const errorType = errorObj.error?.type || "unknown";
      const errorCode = errorObj.error?.code || "";
      const requestId = errorObj.request_id || "";

      return `Error: ${errorMessage}\nType: ${errorType}\nCode: ${errorCode}\nRequest ID: ${requestId}`;
    }

    // Only log if it's an unexpected error format
    console.error(
      "Error in getTextFromContent - content.find is not a function",
    );
    console.error("Content type:", typeof content);
    console.error("Content value:", content);
    console.error("Content is Array:", Array.isArray(content));
    console.error("Error:", error);

    return "";
  }
};

/**
 * Converts a File object to a base64 data URL
 * @param file The file to convert
 * @returns Promise resolving to base64 data URL string
 */
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert file to base64"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
};

/**
 * Converts a Message object to the format expected by the API
 * Strips out thinking and citations from MessageContent as they're metadata, not API content
 * Fetches images from IndexedDB if URL is empty but storageId exists
 * @param message The message to convert
 * @returns Promise resolving to object with role and content for API consumption
 */
export const convertMessageForAPI = async (
  message: Message,
): Promise<{ role: string; content: string | MessageContent[] }> => {
  // If content is a string, return as-is
  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: message.content,
    };
  }

  // If content is an array, strip thinking and citations from text items
  // and fetch images from IndexedDB if needed
  const cleanedContent = await Promise.all(
    message.content.map(async (item) => {
      if (item.type === "text") {
        // Create a copy without thinking and citations
        const { thinking, citations, ...cleanItem } = item;
        return cleanItem;
      }

      // Handle image_url with empty URL but storageId exists
      if (item.type === "image_url" && item.image_url) {
        const { url, storageId } = item.image_url;

        // If URL is empty and storageId exists, fetch from IndexedDB
        if (url === "" && storageId) {
          try {
            const file = await getFile(storageId);
            if (file) {
              const base64Url = await fileToBase64(file);
              return {
                ...item,
                image_url: {
                  ...item.image_url,
                  url: base64Url,
                },
              };
            }
          } catch (error) {
            console.error("Failed to fetch image from IndexedDB:", error);
            // Return the item as-is if fetch fails
          }
        }
      }

      return item;
    }),
  );

  return {
    role: message.role,
    content: cleanedContent,
  };
};

/**
 * Creates a simple text message
 * @param role The message role (user, assistant, system)
 * @param text The text content
 * @returns A Message object with text content
 */
export const createTextMessage = (
  role: string,
  text: string,
  prevId?: string,
): Message => {
  return {
    role,
    content: text,
  };
};

/**
 * Creates a multimodal message with text and attachments
 * @param role The message role (user, assistant, system)
 * @param text The text content
 * @param attachments Array of attachments (images, files, etc.)
 * @returns A Message object with multimodal content
 */
export const createMultimodalMessage = (
  role: string,
  text: string,
  attachments: MessageAttachment[],
): Message => {
  const content: MessageContent[] = [];

  if (text.trim().length > 0) {
    content.push({ type: "text", text });
  }

  attachments.forEach((attachment) => {
    if (attachment.type === "image") {
      content.push({
        type: "image_url",
        image_url: {
          url: attachment.dataUrl,
          storageId: attachment.storageId,
        },
      });
    } else {
      content.push({
        type: "file",
        file: {
          url: attachment.dataUrl,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          storageId: attachment.storageId,
        },
      });

      if (attachment.textContent && attachment.textContent.trim().length > 0) {
        const header = `PDF attachment (${attachment.name}):`;
        content.push({
          type: "text",
          text: `${header}\n\n${attachment.textContent}`,
          hidden: true,
        });
      }
    }
  });

  if (content.length === 0) {
    // Fallback to an empty string message to avoid invalid payloads
    return {
      role,
      content: "",
    };
  }

  return {
    role,
    content,
  };
};

/**
 * Strips image and file data from a single message for storage optimization.
 * Removes base64 data URLs while preserving storageIds for later retrieval.
 * If no storageId exists, replaces media content with placeholder text.
 * @param msg The message to process
 * @returns Message with image/file data removed but structure preserved
 */
export const stripImageDataFromSingleMessage = (msg: Message): Message => {
  if (Array.isArray(msg.content)) {
    // Check if we have storageIds for all media
    const mediaItems = msg.content.filter(
      (item) => item.type === "image_url" || item.type === "file",
    );
    const allHaveStorage = mediaItems.every(
      (item) =>
        (item.type === "image_url" && item.image_url?.storageId) ||
        (item.type === "file" && item.file?.storageId),
    );

    if (allHaveStorage) {
      // If we have storage IDs, we can safely remove the base64 dataUrl to save space
      // but keep the message structure with storageId
      return {
        ...msg,
        content: msg.content.map((item) => {
          if (item.type === "image_url" && item.image_url?.storageId) {
            return {
              ...item,
              image_url: {
                ...item.image_url,
                url: "", // Clear base64, keep storageId
              },
            };
          }
          if (item.type === "file" && item.file?.storageId) {
            return {
              ...item,
              file: {
                ...item.file,
                url: "", // Clear base64, keep storageId
              },
            };
          }
          return item;
        }),
      };
    }

    const textContent = msg.content.filter(
      (item) => item.type === "text" && !item.hidden,
    );
    if (textContent.length === 0) {
      const hasMedia = msg.content.some(
        (item) => item.type === "image_url" || item.type === "file",
      );
      if (hasMedia) {
        return {
          ...msg,
          content:
            "Could not store the image in your browser local storage. Please report to Routstr on Nostr",
        };
      }
      return { ...msg, content: "[Content removed]" };
    }
    return { ...msg, content: textContent };
  }
  return msg;
};

/**
 * Strips image and file data from messages for storage optimization.
 * Removes base64 data URLs while preserving storageIds for later retrieval.
 * If no storageId exists, replaces media content with placeholder text.
 * @param messages Array of messages to process
 * @returns Array of messages with image/file data removed but structure preserved
 */
export const stripImageDataFromMessages = (messages: Message[]): Message[] => {
  return messages.map(stripImageDataFromSingleMessage);
};

/**
 * Extracts thinking tags from streaming AI response chunks.
 * Handles both <thinking> and <thinking> tag formats.
 * @param chunk The current chunk of streaming content
 * @param accumulatedThinking Previously accumulated thinking content
 * @returns Object containing separated thinking and content, plus thinking state
 */
export const extractThinkingFromStream = (
  chunk: string,
  accumulatedThinking: string = "",
): {
  thinking: string;
  content: string;
  isInThinking: boolean;
} => {
  const thinkingStart = /<(?:antml:)?thinking>/;
  const thinkingEnd = /<\/(?:antml:)?thinking>/;

  let thinking = accumulatedThinking;
  let content = "";
  let isInThinking =
    accumulatedThinking.length > 0 &&
    !accumulatedThinking.includes("</thinking>");

  if (isInThinking) {
    const endMatch = chunk.match(thinkingEnd);
    if (endMatch) {
      const endIndex = chunk.indexOf(endMatch[0]);
      thinking += chunk.slice(0, endIndex);
      content = chunk.slice(endIndex + endMatch[0].length);
      isInThinking = false;
    } else {
      thinking += chunk;
    }
  } else {
    const startMatch = chunk.match(thinkingStart);
    if (startMatch) {
      const startIndex = chunk.indexOf(startMatch[0]);
      content = chunk.slice(0, startIndex);

      const remainingChunk = chunk.slice(startIndex + startMatch[0].length);
      const endMatch = remainingChunk.match(thinkingEnd);

      if (endMatch) {
        const endIndex = remainingChunk.indexOf(endMatch[0]);
        thinking = remainingChunk.slice(0, endIndex);
        content += remainingChunk.slice(endIndex + endMatch[0].length);
        isInThinking = false;
      } else {
        thinking = remainingChunk;
        isInThinking = true;
      }
    } else {
      content = chunk;
    }
  }

  return { thinking, content, isInThinking };
};
