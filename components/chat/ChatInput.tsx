import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";
import { ArrowRight, FileText, Loader2, Paperclip, X } from "lucide-react";
import { motion } from "motion/react";
import { MessageAttachment } from "@/types/chat";
import { extractTextFromPdf } from "@/utils/pdfUtils";
import { saveFile } from "@/utils/indexedDb";
import { useBlossomSync } from "@/hooks/useBlossomSync";
import { usePnsKeys } from "@/hooks/usePnsKeys";

// File upload constants
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const BASE_TEXTAREA_HEIGHT = 48;
const ATTACHMENT_ROW_HEIGHT = 88;
const TOOLBAR_ROW_HEIGHT = 40;
const LAYOUT_TRANSITION_MS = 200;
// Character count thresholds for layout switching - provides hysteresis
const ENTER_STACK_CHAR_COUNT = 65; // Switch to stack when exceeding this
const EXIT_STACK_CHAR_COUNT = 50; // Only exit stack below this (hysteresis gap)

type FileKind = {
  isImage: boolean;
  isPdf: boolean;
};

type FileValidationOptions = {
  allowImages: boolean;
  allowPdf: boolean;
  rejectSvg?: boolean;
  onTypeError: (file: File) => void;
  onSizeError: (file: File) => void;
  onSvgError?: () => void;
};

type AttachmentWorkItem = {
  attachment: MessageAttachment;
  file: File;
  shouldExtractPdfText: boolean;
};

type AttachmentBuildOptions = {
  isImage: boolean;
  isPdf: boolean;
  nameOverride?: string;
  storageLabel: "file" | "image";
  logOnStorageError?: boolean;
};

const validateFile = (
  file: File,
  {
    allowImages,
    allowPdf,
    rejectSvg,
    onTypeError,
    onSizeError,
    onSvgError,
  }: FileValidationOptions
): FileKind | null => {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";

  if (rejectSvg && file.type === "image/svg+xml") {
    onSvgError?.();
    return null;
  }

  const isAllowed = (isImage && allowImages) || (isPdf && allowPdf);
  if (!isAllowed) {
    onTypeError(file);
    return null;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    onSizeError(file);
    return null;
  }

  return { isImage, isPdf };
};

const createAttachmentId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const convertFileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });

const getAttachmentLabel = (mimeType: string) => {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) {
    return mimeType.replace("image/", "").toUpperCase();
  }
  return mimeType.toUpperCase();
};

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  uploadedAttachments: MessageAttachment[];
  setUploadedAttachments: React.Dispatch<
    React.SetStateAction<MessageAttachment[]>
  >;
  sendMessage: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
  setTextareaHeight: (height: number) => void;
  isSidebarCollapsed: boolean;
  isMobile: boolean;
  hasMessages: boolean;
  isLoadingModels: boolean;
  isWalletLoading: boolean;
}

export default function ChatInput({
  inputMessage,
  setInputMessage,
  uploadedAttachments,
  setUploadedAttachments,
  sendMessage,
  isLoading,
  isAuthenticated,
  setTextareaHeight,
  isSidebarCollapsed,
  isMobile,
  hasMessages,
  isLoadingModels,
  isWalletLoading,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const minTextareaHeightRef = useRef(BASE_TEXTAREA_HEIGHT);
  const prevInputLengthRef = useRef(inputMessage.length);
  const layoutLockRef = useRef(false);
  const layoutLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [isCentered, setIsCentered] = useState(!hasMessages);
  const [hasMounted, setHasMounted] = useState(false);
  const [initialIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 768px)").matches;
  });
  const [showRedButton, setShowRedButton] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const { uploadToBlossomAsync, blossomSyncEnabled } = useBlossomSync();
  const { pnsKeys } = usePnsKeys();
  const unifiedBgClass = "bg-background";
  const isMobileLayout = hasMounted ? isMobile : initialIsMobile;
  const maxTextareaHeight = isMobileLayout ? 176 : 240;

  // State for layout mode
  const [isStackLayout, setIsStackLayout] = useState(false);

  const useIsomorphicLayoutEffect =
    typeof window !== "undefined" ? useLayoutEffect : useEffect;

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (layoutLockTimeoutRef.current) {
        clearTimeout(layoutLockTimeoutRef.current);
      }
    };
  }, []);

  const lockMinHeight = useCallback(() => {
    layoutLockRef.current = true;
    if (layoutLockTimeoutRef.current) {
      clearTimeout(layoutLockTimeoutRef.current);
    }
    layoutLockTimeoutRef.current = setTimeout(() => {
      layoutLockRef.current = false;
    }, LAYOUT_TRANSITION_MS);
  }, []);

  // Ref to track previous stack layout for comparison without causing re-renders
  const prevIsStackLayoutRef = useRef(isStackLayout);

  // Update layout mode based on content - uses character count for stability
  useIsomorphicLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Check for explicit line breaks
    const hasLineBreak = inputMessage.includes("\n");

    // Use character count with hysteresis to prevent jitter
    // The different thresholds create a "dead zone" where layout doesn't change
    const currentlyStacked = prevIsStackLayoutRef.current;
    let shouldStack: boolean;

    if (currentlyStacked) {
      // When in stack mode, only exit if BELOW the exit threshold AND no line breaks
      shouldStack =
        inputMessage.length > EXIT_STACK_CHAR_COUNT ||
        hasLineBreak ||
        uploadedAttachments.length > 0;
    } else {
      // When in single-line mode, enter stack if ABOVE the enter threshold OR has line breaks
      shouldStack =
        inputMessage.length > ENTER_STACK_CHAR_COUNT ||
        hasLineBreak ||
        uploadedAttachments.length > 0;
    }

    // Only update if the state is actually changing
    if (shouldStack !== prevIsStackLayoutRef.current) {
      lockMinHeight();
      prevIsStackLayoutRef.current = shouldStack;
      setIsStackLayout(shouldStack);
    }

    // Still need to measure for height calculation (but not for layout decision)
    const originalHeight = textarea.style.height;
    textarea.style.height = "auto";
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = originalHeight;

    const clampedHeight = Math.min(scrollHeight, maxTextareaHeight);
    const nextMinHeight = Math.max(clampedHeight, BASE_TEXTAREA_HEIGHT);
    const allowDecrease =
      inputMessage.length < prevInputLengthRef.current ||
      (prevIsStackLayoutRef.current && !layoutLockRef.current);
    if (allowDecrease || nextMinHeight > minTextareaHeightRef.current) {
      minTextareaHeightRef.current = nextMinHeight;
    }
    prevInputLengthRef.current = inputMessage.length;
  }, [
    inputMessage,
    uploadedAttachments.length,
    maxTextareaHeight,
    lockMinHeight,
  ]);

  const getExtraHeight = useCallback(() => {
    const attachmentHeight =
      uploadedAttachments.length > 0 ? ATTACHMENT_ROW_HEIGHT : 0;
    const toolbarHeight = isStackLayout ? TOOLBAR_ROW_HEIGHT : 0;
    return attachmentHeight + toolbarHeight;
  }, [uploadedAttachments.length, isStackLayout]);

  const getTextareaOnlyHeight = useCallback(
    (scrollHeight: number) => {
      const clampedHeight = Math.min(scrollHeight, maxTextareaHeight);
      const minHeight = Math.min(
        minTextareaHeightRef.current,
        maxTextareaHeight
      );
      return Math.max(clampedHeight, minHeight);
    },
    [maxTextareaHeight]
  );

  const updateAttachment = useCallback(
    (
      attachmentId: string,
      updater: (attachment: MessageAttachment) => MessageAttachment
    ) => {
      setUploadedAttachments((prev) =>
        prev.map((item) => (item.id === attachmentId ? updater(item) : item))
      );
    },
    [setUploadedAttachments]
  );

  const persistFile = useCallback(
    async (
      file: File,
      label: "file" | "image",
      logOnStorageError?: boolean
    ): Promise<string | undefined> => {
      try {
        return await saveFile(file);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("quota")) {
          alert(
            `Storage is full. Your ${label} will be available in this session but may not be saved in history.`
          );
        } else if (logOnStorageError) {
          console.warn("Failed to save file to storage:", errorMessage);
        }
        return undefined;
      }
    },
    []
  );

  const buildAttachmentWorkItem = useCallback(
    async ({
      file,
      isImage,
      isPdf,
      nameOverride,
      storageLabel,
      logOnStorageError,
    }: AttachmentBuildOptions & {
      file: File;
    }): Promise<AttachmentWorkItem> => {
      const dataUrl = await convertFileToBase64(file);
      const storageId = await persistFile(
        file,
        storageLabel,
        logOnStorageError
      );
      const attachmentId = createAttachmentId();
      const attachment: MessageAttachment = {
        id: attachmentId,
        name: nameOverride || file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl,
        type: isImage ? "image" : "file",
        storageId,
        blossomUploadStatus:
          blossomSyncEnabled && pnsKeys ? "uploading" : undefined,
      };

      return {
        attachment,
        file,
        shouldExtractPdfText: isPdf,
      };
    },
    [blossomSyncEnabled, pnsKeys, persistFile]
  );

  /**
   * Helper to handle Blossom upload for an attachment
   * Updates the attachment state with hash/servers on success or failed status on error
   */
  const handleBlossomUpload = useCallback(
    (attachmentId: string, file: File) => {
      if (!blossomSyncEnabled || !pnsKeys) return;

      uploadToBlossomAsync(file, pnsKeys)
        .then((result) => {
          if (result) {
            updateAttachment(attachmentId, (item) => ({
              ...item,
              blossomHash: result.hash,
              blossomServers: result.servers,
              blossomUploadStatus: "success",
            }));
          } else {
            updateAttachment(attachmentId, (item) => ({
              ...item,
              blossomUploadStatus: "failed",
            }));
          }
        })
        .catch(() => {
          updateAttachment(attachmentId, (item) => ({
            ...item,
            blossomUploadStatus: "failed",
          }));
        });
    },
    [blossomSyncEnabled, pnsKeys, updateAttachment, uploadToBlossomAsync]
  );

  const addAttachmentsWithProcessing = useCallback(
    (workItems: AttachmentWorkItem[]) => {
      if (workItems.length === 0) return;

      setUploadedAttachments((prev) => [
        ...prev,
        ...workItems.map((item) => item.attachment),
      ]);

      workItems.forEach(({ attachment, file, shouldExtractPdfText }) => {
        if (shouldExtractPdfText) {
          extractTextFromPdf(file)
            .then((text) => {
              if (!text.trim()) return;
              updateAttachment(attachment.id, (item) => ({
                ...item,
                textContent: text,
              }));
            })
            .catch((error) => {
              console.warn(
                "Failed to extract text from PDF attachment, continuing without text content.",
                error
              );
            });
        }

        handleBlossomUpload(attachment.id, file);
      });
    },
    [handleBlossomUpload, setUploadedAttachments, updateAttachment]
  );

  // Handle centering when messages change from external updates
  useEffect(() => {
    // Center when no messages, bottom when messages exist (both mobile and desktop)
    setIsCentered(!hasMessages);
  }, [hasMessages]);

  // Keep textarea height in sync with content and clamp to max height
  // Also account for attachment preview height (if any)
  useEffect(() => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    let textareaOnlyHeight = BASE_TEXTAREA_HEIGHT;

    if (inputMessage === "") {
      textarea.style.height = `${BASE_TEXTAREA_HEIGHT}px`;
      textareaOnlyHeight = BASE_TEXTAREA_HEIGHT;
    } else {
      textarea.style.height = "auto";
      textareaOnlyHeight = getTextareaOnlyHeight(textarea.scrollHeight);
      textarea.style.height = `${textareaOnlyHeight}px`;
    }

    setTextareaHeight(textareaOnlyHeight + getExtraHeight());
  }, [inputMessage, setTextareaHeight, getExtraHeight, getTextareaOnlyHeight]);

  const handleSendMessage = () => {
    if (isLoading) {
      return;
    }
    sendMessage();
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files) return;

    const workItems: AttachmentWorkItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = validateFile(file, {
        allowImages: true,
        allowPdf: true,
        onTypeError: () =>
          alert(
            `File type "${file.type}" is not supported. Please upload images or PDF files.`
          ),
        onSizeError: () =>
          alert(
            `File "${file.name}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
          ),
      });

      if (!validation) continue;

      try {
        const workItem = await buildAttachmentWorkItem({
          file,
          ...validation,
          storageLabel: "file",
          logOnStorageError: true,
        });
        workItems.push(workItem);
      } catch (error) {
        console.error("Error converting file to base64:", error);
      }
    }

    addAttachmentsWithProcessing(workItems);

    if (event.target) {
      event.target.value = "";
    }
  };

  const removeAttachment = (id: string) => {
    setUploadedAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const handlePaste = async (
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageItems: DataTransferItem[] = [];

    // Collect all image items from clipboard
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length === 0) return;

    // Prevent default paste behavior for images
    event.preventDefault();

    const workItems: AttachmentWorkItem[] = [];

    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;

      const validation = validateFile(file, {
        allowImages: true,
        allowPdf: false,
        onTypeError: () => {},
        onSizeError: () =>
          alert(
            `Pasted image is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
          ),
      });

      if (!validation) continue;

      try {
        const nameOverride =
          file.name || `pasted-image-${Date.now()}.${file.type.split("/")[1]}`;
        const workItem = await buildAttachmentWorkItem({
          file,
          ...validation,
          nameOverride,
          storageLabel: "image",
        });
        workItems.push(workItem);
      } catch (error) {
        console.error("Error converting pasted image to base64:", error);
      }
    }

    addAttachmentsWithProcessing(workItems);
  };

  // Drag and Drop Handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;

    // Check if the dragged item contains files
    if (e.dataTransfer.types && e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;

    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // This is necessary to allow dropping
    e.dataTransfer.dropEffect = "copy";
  };

  const processImageFile = async (file: File) => {
    const validation = validateFile(file, {
      allowImages: true,
      allowPdf: true,
      rejectSvg: true,
      onSvgError: () =>
        alert("SVG files are not supported. Please use PNG, JPG, or WebP"),
      onTypeError: () => alert("Please select an image or PDF file"),
      onSizeError: () =>
        alert(
          `File "${file.name}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
        ),
    });

    if (!validation) return;

    try {
      const workItem = await buildAttachmentWorkItem({
        file,
        ...validation,
        storageLabel: "file",
      });
      addAttachmentsWithProcessing([workItem]);
    } catch (error) {
      console.error("Error processing file:", error);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      // Process all dropped files
      for (let i = 0; i < files.length; i++) {
        await processImageFile(files[i]);
      }
    }
  };

  return (
    <>
      {/* Greeting message when centered */}
      {isCentered && (
        <div
          className={`fixed z-20 flex flex-col items-center pointer-events-none ${
            isMobileLayout || !isAuthenticated
              ? "inset-x-0"
              : isSidebarCollapsed
                ? "inset-x-0"
                : "left-72 right-0"
          }`}
          style={{
            top: "50%",
            transform: isMobileLayout
              ? "translateY(calc(-50% - 100px))"
              : "translateY(calc(-50% - 120px))",
          }}
        >
          <div className="text-center mb-4">
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
              How can I help?
            </h1>
          </div>
        </div>
      )}
      {/* Chat Input Container */}
      <div
        className={`${
          isCentered && !isMobileLayout
            ? `fixed z-20 flex items-start justify-center ${
                !isAuthenticated
                  ? "inset-x-0"
                  : isSidebarCollapsed
                    ? "inset-x-0"
                    : "left-72 right-0"
              }`
            : `${
                isMobileLayout
                  ? `fixed z-20 left-0 right-0 w-screen ${unifiedBgClass} backdrop-blur-sm px-0 pb-2 pt-0`
                  : "fixed z-20 bg-background backdrop-blur-sm " +
                    (!isAuthenticated
                      ? "left-0 right-0 pb-4 pt-0"
                      : isSidebarCollapsed
                        ? "left-0 right-0 pb-4 pt-0"
                        : "left-72 right-0 pb-4 pt-0")
              }`
        }`}
        style={{
          top: isCentered && !isMobileLayout ? "calc(50% - 56px)" : undefined,
          bottom:
            isMobileLayout || !isCentered
              ? isMobileLayout
                ? "0px"
                : "16px"
              : undefined,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          className={`${
            isMobileLayout
              ? "w-full max-w-none px-4 pb-3"
              : "mx-auto w-full " +
                (isCentered ? "max-w-152" : "max-w-176") +
                " px-4 sm:px-6 lg:px-0"
          }`}
        >
          {/* Unified Input Container with Attachment Preview Inside */}
          <div
            className={`relative flex flex-col w-full rounded-3xl overflow-hidden ${
              isDragging
                ? "bg-linear-to-br from-purple-500/20 via-purple-500/10 to-purple-500/5 border-2 border-dashed border-purple-400/70 shadow-[0_0_40px_-5px_rgba(168,85,247,0.5)] scale-[1.01]"
                : "bg-muted/50 border border-border"
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Attachment Preview - First Row */}
            {uploadedAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3 pb-2 animate-in fade-in slide-in-from-top-2 duration-300">
                {uploadedAttachments.map((attachment, index) => (
                  <div
                    key={attachment.id}
                    className="relative group animate-in fade-in zoom-in-95 duration-200"
                    style={{
                      animationDelay: `${index * 50}ms`,
                      animationFillMode: "backwards",
                    }}
                  >
                    {attachment.type === "image" ? (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="w-16 h-16 object-cover rounded-lg border border-border"
                      />
                    ) : (
                      <div className="flex w-[220px] max-w-full h-16 items-center gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2">
                        <FileText
                          className="h-5 w-5 text-foreground/80 shrink-0"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-medium text-foreground"
                            title={attachment.name}
                          >
                            {attachment.name}
                          </p>
                          <p className="text-xs uppercase text-muted-foreground">
                            {getAttachmentLabel(attachment.mimeType)}
                          </p>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(attachment.id)}
                      className={`absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-opacity duration-150 ${
                        isMobileLayout
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea and Buttons - Second Row */}
            <div
              className="relative flex w-full"
              style={{
                paddingBottom: isStackLayout ? 48 : 4,
                transition: "padding-bottom 0.2s ease-in-out",
              }}
            >
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    (!isMobileLayout || e.metaKey || e.ctrlKey)
                  ) {
                    e.preventDefault();
                    // Prevent sending when models or wallet are still loading
                    if (isLoading || isLoadingModels || isWalletLoading) {
                      // Show red button for 1 second
                      setShowRedButton(true);
                      setTimeout(() => setShowRedButton(false), 1000);
                      return;
                    }
                    handleSendMessage();
                  }
                }}
                placeholder={
                  isAuthenticated
                    ? isCentered
                      ? `Type your message...`
                      : `Ask anything...`
                    : `Sign in to start chatting...`
                }
                className="bg-transparent py-3 text-[16.5px] sm:text-[16.5px] text-foreground placeholder:text-muted-foreground focus:outline-none resize-none min-h-[48px] overflow-y-auto w-full"
                autoComplete="off"
                data-tutorial="chat-input"
                rows={1}
                style={{
                  height: "auto",
                  minHeight: "48px",
                  maxHeight: maxTextareaHeight,
                  fontSize: "16px",
                  paddingLeft: isStackLayout ? 16 : 56,
                  paddingRight: isStackLayout ? 16 : 48,
                  transition: "padding 0.2s ease-in-out",
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  const textareaOnlyHeight = getTextareaOnlyHeight(
                    target.scrollHeight
                  );
                  target.style.height = `${textareaOnlyHeight}px`;
                  setTextareaHeight(textareaOnlyHeight + getExtraHeight());
                }}
              />

              {/* Toolbar or Absolute Buttons */}
              <div className="absolute bottom-2 left-0 right-0 flex w-full items-center justify-between px-3 pointer-events-none">
                {/* Attachment upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!isAuthenticated}
                  className={`p-2 rounded-full bg-transparent hover:bg-muted disabled:opacity-50 disabled:bg-transparent transition-colors cursor-pointer pointer-events-auto`}
                  aria-label="Upload attachment"
                >
                  <Paperclip className="h-5 w-5 text-foreground" />
                </button>

                {/* Send button */}
                <button
                  onClick={handleSendMessage}
                  disabled={
                    isLoading ||
                    isLoadingModels ||
                    isWalletLoading ||
                    (!isAuthenticated &&
                      !inputMessage.trim() &&
                      uploadedAttachments.length === 0)
                  }
                  className={`p-2 rounded-full transition-colors text-foreground ${
                    showRedButton
                      ? "bg-red-500 hover:bg-red-600 text-white"
                      : "bg-transparent hover:bg-secondary disabled:hover:bg-transparent"
                  } disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer pointer-events-auto`}
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Bottom spacer for visible padding below the input */}
      {(!isCentered || isMobileLayout) && (
        <div
          className={`fixed bottom-0 z-20 pointer-events-none ${
            !isAuthenticated
              ? "left-0 right-0"
              : isSidebarCollapsed
                ? "left-0 right-0"
                : "left-72 right-0"
          } ${isMobileLayout ? "h-3" : "h-4"} ${unifiedBgClass}`}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        />
      )}
    </>
  );
}
