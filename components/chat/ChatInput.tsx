import { useRef, useEffect, useState } from "react";
import { ArrowRight, FileText, Loader2, Paperclip, X } from "lucide-react";
import { useChat } from "@/context/ChatProvider";
import { MessageAttachment } from "@/types/chat";
import { extractTextFromPdf } from "@/utils/pdfUtils";
import { saveFile } from "@/utils/indexedDb";

// File upload constants
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_FILE_TYPES = ["application/pdf"];
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

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
  textareaHeight: number;
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
  textareaHeight,
  setTextareaHeight,
  isSidebarCollapsed,
  isMobile,
  hasMessages,
  isLoadingModels,
  isWalletLoading,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isCentered, setIsCentered] = useState(!hasMessages);
  const [showRedButton, setShowRedButton] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const { isSidebarOpen } = useChat();
  const unifiedBgClass = "bg-background";
  const maxTextareaHeight = isMobile ? 176 : 240;

  // Handle centering when messages change from external updates
  useEffect(() => {
    // Center when no messages, bottom when messages exist (both mobile and desktop)
    if (hasMessages && isCentered) {
      setIsCentered(false);
    } else if (!hasMessages && !isCentered) {
      setIsCentered(true);
    }
  }, [hasMessages, isCentered]);

  // Keep textarea height in sync with content and clamp to max height
  // Also account for attachment preview height (if any)
  useEffect(() => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    let textareaOnlyHeight = 48;

    if (inputMessage === "") {
      textarea.style.height = "48px";
      textareaOnlyHeight = 48;
    } else {
      textarea.style.height = "auto";
      textareaOnlyHeight = Math.min(textarea.scrollHeight, maxTextareaHeight);
      textarea.style.height = textareaOnlyHeight + "px";
    }

    // Calculate total input container height including attachments
    // Attachment row adds ~88px (64px height + 12px top padding + 8px bottom padding + 4px bottom margin)
    const attachmentHeight = uploadedAttachments.length > 0 ? 88 : 0;
    const totalHeight = textareaOnlyHeight + attachmentHeight;
    setTextareaHeight(totalHeight);
  }, [
    inputMessage,
    maxTextareaHeight,
    setTextareaHeight,
    uploadedAttachments.length,
  ]);

  const handleSendMessage = () => {
    if (isLoading) {
      return;
    }

    if (isCentered) {
      // Don't trigger multiple animations - let the useEffect handle it
      sendMessage();
    } else {
      sendMessage();
    }
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

  const getAttachmentLabel = (mimeType: string) => {
    if (mimeType === "application/pdf") return "PDF";
    if (mimeType.startsWith("image/")) {
      return mimeType.replace("image/", "").toUpperCase();
    }
    return mimeType.toUpperCase();
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files) return;

    const attachmentsToAdd: { attachment: MessageAttachment; file: File }[] =
      [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImage = file.type.startsWith("image/");
      const isAcceptedFile = ACCEPTED_FILE_TYPES.includes(file.type);

      // Validate file type
      if (!isImage && !isAcceptedFile) {
        alert(
          `File type "${file.type}" is not supported. Please upload images or PDF files.`
        );
        continue;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE_BYTES) {
        alert(
          `File "${file.name}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
        );
        continue;
      }

      try {
        const dataUrl = await convertFileToBase64(file);

        // Save to IndexedDB
        let storageId: string | undefined;
        try {
          storageId = await saveFile(file);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          if (errorMessage.includes("quota")) {
            alert(
              "Storage is full. Your file will be available in this session but may not be saved in history."
            );
          } else {
            console.warn("Failed to save file to storage:", errorMessage);
          }
          // Continue without storageId (will rely on base64 in memory)
        }

        const attachment: MessageAttachment = {
          id: createAttachmentId(),
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl,
          type: isImage ? "image" : "file",
          storageId,
        };

        attachmentsToAdd.push({ attachment, file });
      } catch (error) {
        console.error("Error converting file to base64:", error);
      }
    }

    if (attachmentsToAdd.length > 0) {
      console.log(attachmentsToAdd);
      setUploadedAttachments((prev) => [
        ...prev,
        ...attachmentsToAdd.map((item) => item.attachment),
      ]);

      attachmentsToAdd.forEach(({ attachment, file }) => {
        if (attachment.mimeType === "application/pdf") {
          extractTextFromPdf(file)
            .then((text) => {
              if (!text.trim()) return;
              setUploadedAttachments((prev) =>
                prev.map((item) =>
                  item.id === attachment.id
                    ? { ...item, textContent: text }
                    : item
                )
              );
            })
            .catch((error) => {
              console.warn(
                "Failed to extract text from PDF attachment, continuing without text content.",
                error
              );
            });
        }
      });
    }

    if (event.target) {
      event.target.value = "";
    }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
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

    const attachmentsToAdd: { attachment: MessageAttachment; file: File }[] =
      [];

    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;

      // Validate file size
      if (file.size > MAX_FILE_SIZE_BYTES) {
        alert(
          `Pasted image is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
        );
        continue;
      }

      try {
        const dataUrl = await convertFileToBase64(file);

        // Save to IndexedDB
        let storageId: string | undefined;
        try {
          storageId = await saveFile(file);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          if (errorMessage.includes("quota")) {
            alert(
              "Storage is full. Your image will be available in this session but may not be saved in history."
            );
          }
          // Continue without storageId
        }

        const attachment: MessageAttachment = {
          id: createAttachmentId(),
          name:
            file.name ||
            `pasted-image-${Date.now()}.${file.type.split("/")[1]}`,
          mimeType: file.type,
          size: file.size,
          dataUrl,
          type: "image",
          storageId,
        };

        attachmentsToAdd.push({ attachment, file });
      } catch (error) {
        console.error("Error converting pasted image to base64:", error);
      }
    }

    if (attachmentsToAdd.length > 0) {
      setUploadedAttachments((prev) => [
        ...prev,
        ...attachmentsToAdd.map((item) => item.attachment),
      ]);
    }
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
    // Validate file type - accept images and PDFs
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";

    if (!isImage && !isPdf) {
      alert("Please select an image or PDF file");
      return;
    }

    // Reject SVG files
    if (file.type === "image/svg+xml") {
      alert("SVG files are not supported. Please use PNG, JPG, or WebP");
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      alert(
        `File "${file.name}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`
      );
      return;
    }

    try {
      const dataUrl = await convertFileToBase64(file);

      // Save to IndexedDB
      let storageId: string | undefined;
      try {
        storageId = await saveFile(file);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("quota")) {
          alert(
            "Storage is full. Your file will be available in this session but may not be saved in history."
          );
        }
        // Continue without storageId
      }

      const attachment: MessageAttachment = {
        id: createAttachmentId(),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl,
        type: isImage ? "image" : "file",
        storageId,
      };

      setUploadedAttachments((prev) => [...prev, attachment]);

      // Extract text from PDF if applicable
      if (isPdf) {
        extractTextFromPdf(file)
          .then((text) => {
            if (!text.trim()) return;
            setUploadedAttachments((prev) =>
              prev.map((item) =>
                item.id === attachment.id
                  ? { ...item, textContent: text }
                  : item
              )
            );
          })
          .catch((error) => {
            console.warn(
              "Failed to extract text from PDF attachment, continuing without text content.",
              error
            );
          });
      }
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
            isMobile || !isAuthenticated
              ? "inset-x-0"
              : isSidebarCollapsed
                ? "inset-x-0"
                : "left-72 right-0"
          }`}
          style={{
            top: "50%",
            transform: isMobile
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
          isCentered && !isMobile
            ? `fixed z-20 flex items-start justify-center transition-all duration-500 ease-out ${
                !isAuthenticated
                  ? "inset-x-0"
                  : isSidebarCollapsed
                    ? "inset-x-0"
                    : "left-72 right-0"
              }`
            : `${
                isMobile
                  ? `fixed z-20 left-0 right-0 w-screen ${unifiedBgClass} backdrop-blur-sm transition-all duration-300 ease-in-out px-0 pb-2 pt-0`
                  : "fixed z-20 bg-background backdrop-blur-sm transition-all duration-300 ease-in-out " +
                    (!isAuthenticated
                      ? "left-0 right-0 pb-4 pt-0"
                      : isSidebarCollapsed
                        ? "left-0 right-0 pb-4 pt-0"
                        : "left-72 right-0 pb-4 pt-0")
              }`
        }`}
        style={{
          top: isCentered && !isMobile ? "calc(50% - 56px)" : undefined,
          bottom:
            isMobile || !isCentered ? (isMobile ? "0px" : "16px") : undefined,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          className={`${
            isMobile
              ? "w-full max-w-none px-4 pb-3"
              : "mx-auto w-full " +
                (isCentered ? "max-w-152" : "max-w-176") +
                " px-4 sm:px-6 lg:px-0"
          }`}
        >
          {/* Unified Input Container with Attachment Preview Inside */}
          <div
            className={`relative flex flex-col w-full rounded-full transition-all duration-300 ease-out ${
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
                        isMobile
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
            <div className="relative flex items-center w-full pb-1">
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    (!isMobile || e.metaKey || e.ctrlKey)
                  ) {
                    e.preventDefault();
                    if (isLoading) {
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
                className="flex-1 bg-transparent px-4 py-3 text-[16.5px] sm:text-[16.5px] text-foreground placeholder:text-muted-foreground focus:outline-none pl-14 pr-12 resize-none min-h-[48px] overflow-y-auto"
                autoComplete="off"
                data-tutorial="chat-input"
                rows={1}
                style={{
                  height: "auto",
                  minHeight: "48px",
                  maxHeight: maxTextareaHeight,
                  fontSize: "16px",
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  const textareaOnlyHeight = Math.min(
                    target.scrollHeight,
                    maxTextareaHeight
                  );
                  target.style.height = textareaOnlyHeight + "px";
                  // Include attachment height in total height
                  const attachmentHeight =
                    uploadedAttachments.length > 0 ? 88 : 0;
                  setTextareaHeight(textareaOnlyHeight + attachmentHeight);
                }}
              />

              {/* Attachment upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!isAuthenticated}
                className="absolute left-3 bottom-2 p-2 rounded-full bg-transparent hover:bg-muted disabled:opacity-50 disabled:bg-transparent transition-colors cursor-pointer"
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
                className={`absolute right-3 bottom-2 p-2 rounded-full transition-colors text-foreground ${
                  showRedButton
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "bg-transparent hover:bg-secondary disabled:hover:bg-transparent"
                } disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
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
      {/* Bottom spacer for visible padding below the input */}
      {(!isCentered || isMobile) && (
        <div
          className={`fixed bottom-0 z-20 pointer-events-none ${
            !isAuthenticated
              ? "left-0 right-0"
              : isSidebarCollapsed
                ? "left-0 right-0"
                : "left-72 right-0"
          } ${isMobile ? "h-3" : "h-4"} ${unifiedBgClass}`}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        />
      )}
    </>
  );
}
