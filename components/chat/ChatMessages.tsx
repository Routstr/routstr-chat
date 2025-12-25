import { Message, MessageContent } from "@/types/chat";
import { Edit, Copy, Check, Eye, EyeOff, FileText } from "lucide-react";
import MessageContentRenderer from "@/components/MessageContent";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import ThinkingSection from "@/components/ui/ThinkingSection";
import VersionNavigator from "@/components/chat/VersionNavigator";
import {
  RefObject,
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";

// Helper function to extract thinking from message content
const getThinkingFromContent = (
  content: string | MessageContent[]
): string | undefined => {
  if (typeof content === "string") return undefined;

  const textContent = content.find((item) => item.type === "text");
  return textContent?.thinking;
};

// Helper function to extract citations from message content
const getCitationsFromContent = (
  content: string | MessageContent[]
): string[] | undefined => {
  if (typeof content === "string") return undefined;

  const textContent = content.find((item) => item.type === "text");
  return textContent?.citations;
};

// Helper function to extract annotations from message content
const getAnnotationsFromContent = (
  content: string | MessageContent[]
): import("@/types/chat").AnnotationData[] | undefined => {
  if (typeof content === "string") return undefined;

  const textContent = content.find((item) => item.type === "text");
  return textContent?.annotations;
};

interface ChatMessagesProps {
  messages: Message[];
  streamingContent: string;
  thinkingContent: string;
  editingMessageIndex: number | null;
  editingContent: string;
  setEditingContent: (content: string) => void;
  startEditingMessage: (index: number) => void;
  cancelEditing: () => void;
  saveInlineEdit: () => void;
  retryMessage: (index: number) => void;
  getTextFromContent: (content: string | MessageContent[]) => string;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  isMobile: boolean;
  textareaHeight?: number;
  isLoading: boolean;
}

export default function ChatMessages({
  messages,
  streamingContent,
  thinkingContent,
  editingMessageIndex,
  editingContent,
  setEditingContent,
  startEditingMessage,
  cancelEditing,
  saveInlineEdit,
  retryMessage,
  getTextFromContent,
  messagesEndRef,
  isMobile,
  textareaHeight,
  isLoading,
}: ChatMessagesProps) {
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(
    null
  );
  const [expandedSystemGroups, setExpandedSystemGroups] = useState<Set<string>>(
    new Set()
  );
  const [selectedVersions, setSelectedVersions] = useState<Map<number, string>>(
    new Map()
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Helper function to check if a system message should always be shown
  const shouldAlwaysShowSystemMessage = (
    content: string | MessageContent[]
  ): boolean => {
    const textContent = getTextFromContent(content);
    return (
      textContent.trim().startsWith("ATTENTION") ||
      textContent.trim().startsWith("Uncaught Error") ||
      textContent.trim().startsWith("Unknown Error")
    );
  };

  // Reset selectedVersions if any selected eventId is not in the messages list
  useEffect(() => {
    // Only proceed if there are selected versions
    if (selectedVersions.size === 0) return;

    // Create a Set of all message eventIds for fast lookup
    const messageEventIds = new Set(
      messages
        .map((msg) => msg._eventId)
        .filter((id): id is string => id !== undefined)
    );

    // Check if any selected version's eventId is not in the messages list
    const hasInvalidSelection = Array.from(selectedVersions.values()).some(
      (eventId) => !messageEventIds.has(eventId)
    );

    // If any invalid selection found, reset the map
    if (hasInvalidSelection) {
      setSelectedVersions(new Map());
    }
  }, [messages]);

  // Helper: Check if a message should always be shown individually
  const isStandaloneSystemMessage = (msg: Message): boolean => {
    if (msg.role !== "system") return false;
    return shouldAlwaysShowSystemMessage(msg.content);
  };

  // Helper: Identify system message groups and return group metadata
  const identifySystemGroups = (): Map<
    number,
    { firstMessage: Message; count: number }
  > => {
    const systemGroupMap = new Map<
      number,
      { firstMessage: Message; count: number }
    >();
    let currentGroupStart: number | null = null;
    let currentGroupCount = 0;

    messages.forEach((message, index) => {
      if (message.role === "system" && !isStandaloneSystemMessage(message)) {
        if (currentGroupStart === null) {
          currentGroupStart = index;
          currentGroupCount = 1;
        } else {
          currentGroupCount++;
        }
      } else {
        if (currentGroupStart !== null) {
          systemGroupMap.set(currentGroupStart, {
            firstMessage: messages[currentGroupStart],
            count: currentGroupCount,
          });
          currentGroupStart = null;
          currentGroupCount = 0;
        }
      }
    });

    // Handle trailing group
    if (currentGroupStart !== null) {
      systemGroupMap.set(currentGroupStart, {
        firstMessage: messages[currentGroupStart],
        count: currentGroupCount,
      });
    }

    return systemGroupMap;
  };

  // Group messages by their depth in the conversation tree
  // System message groups are treated as a single version (represented by their first message)
  const messageVersions = useMemo(() => {
    const groups = new Map<number, Message[]>();

    const systemGroupMap = identifySystemGroups();

    // Filter messages: exclude system messages that are part of a group (keep only first of each group)
    const messagesToVersion: Message[] = [];
    const messageIndexMap = new Map<Message, number>(); // Maps message to original index

    let skipUntilIndex = -1;
    messages.forEach((msg, index) => {
      // If we're skipping (inside a system group), continue until we're past it
      if (index <= skipUntilIndex) return;

      // Check if this is the start of a system group
      const systemGroup = systemGroupMap.get(index);
      if (systemGroup) {
        // Add only the first message of the group
        messagesToVersion.push(systemGroup.firstMessage);
        messageIndexMap.set(systemGroup.firstMessage, index);
        // Skip the rest of the group
        skipUntilIndex = index + systemGroup.count - 1;
      } else {
        // Regular message (user, assistant, or standalone system)
        messagesToVersion.push(msg);
        messageIndexMap.set(msg, index);
      }
    });

    // Build adjacency list for tree structure
    const childrenMap = new Map<string, Message[]>();
    const roots: Message[] = [];

    messagesToVersion.forEach((msg) => {
      if (!msg._prevId || msg._prevId === "0".repeat(64)) {
        roots.push(msg);
      } else {
        if (!childrenMap.has(msg._prevId)) {
          childrenMap.set(msg._prevId, []);
        }
        childrenMap.get(msg._prevId)!.push(msg);
      }
    });

    // Helper function to get the event ID of the last message in a system group
    const getEventIdForLastMessage = (
      eventId: string,
      systemGroupMap: Map<number, { firstMessage: Message; count: number }>
    ): string | undefined => {
      if (!eventId) return eventId;

      // Find the group that starts with this eventId
      for (const [startIndex, group] of systemGroupMap) {
        if (group.firstMessage._eventId === eventId) {
          // Found the group, calculate the index of the last message
          const lastMessageIndex = startIndex + group.count - 1;

          // Return the eventId of the last message in this group
          if (lastMessageIndex < messages.length) {
            return messages[lastMessageIndex]._eventId;
          }
        }
      }

      // If not found in any group, return the original eventId
      return eventId;
    };

    // BFS traversal to assign depth-based groups
    let currentDepth = 0;
    let currentLevel = roots;

    while (currentLevel.length > 0) {
      // Sort by creation time for consistent ordering
      currentLevel.sort((a, b) => (a._createdAt || 0) - (b._createdAt || 0));
      groups.set(currentDepth, currentLevel);

      const nextLevel: Message[] = [];
      currentLevel.forEach((msg) => {
        let lastEventId = msg._eventId;
        if (msg.role === "system" && lastEventId)
          lastEventId = getEventIdForLastMessage(lastEventId, systemGroupMap);
        if (lastEventId && childrenMap.has(lastEventId)) {
          nextLevel.push(...childrenMap.get(lastEventId)!);
        }
      });

      currentDepth++;
      currentLevel = nextLevel;
    }

    return groups;
  }, [messages]);

  const getMessageToDisplay = (message: Message, index: number) => {
    const versions = messageVersions.get(index);

    if (!versions || versions.length <= 1) {
      return { msg: message, currentVersion: 1, totalVersions: 1 };
    }

    // Check if a specific version is selected for this "slot" (identified by index)
    const selectedId = selectedVersions.get(index);

    if (selectedId) {
      const selectedMsg = versions.find((v) => v._eventId === selectedId);
      if (selectedMsg) {
        const versionIndex = versions.findIndex(
          (v) => v._eventId === selectedId
        );
        return {
          msg: selectedMsg,
          currentVersion: versionIndex + 1,
          totalVersions: versions.length,
        };
      }
    }

    // Default to the message passed in (which comes from the main thread)
    // We need to find its index in the sorted versions array
    const currentIndex = versions.findIndex(
      (v) => v._eventId === message._eventId
    );

    // If for some reason the message isn't in the group (shouldn't happen), default to last
    if (currentIndex === -1) {
      return {
        msg: versions[versions.length - 1],
        currentVersion: versions.length,
        totalVersions: versions.length,
      };
    }

    return {
      msg: message,
      currentVersion: currentIndex + 1,
      totalVersions: versions.length,
    };
  };

  const handleVersionChange = useCallback(
    (index: number, direction: "prev" | "next", currentMessageId: string) => {
      const versions = messageVersions.get(index);
      console.log("ed", versions, index, messageVersions);
      if (!versions) return;

      const currentSelectedId = selectedVersions.get(index) || currentMessageId;
      const currentIndex = versions.findIndex(
        (v) => v._eventId === currentSelectedId
      );
      console.log(currentIndex, currentSelectedId, selectedVersions);

      if (currentIndex === -1) return;

      let newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;

      // Clamp index
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= versions.length) newIndex = versions.length - 1;

      const newVersionId = versions[newIndex]._eventId;
      if (newVersionId) {
        setSelectedVersions((prev) => new Map(prev).set(index, newVersionId));
      }
    },
    [messageVersions, selectedVersions]
  );

  const systemGroupsMap = identifySystemGroups();

  // Toggle a specific system message group
  const toggleSystemGroup = (eventId: string) => {
    setExpandedSystemGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  // Check if a message belongs to an expanded group
  const isInExpandedGroup = (eventId: string | undefined): boolean => {
    if (!eventId) return false;
    const messageIndex = messages.findIndex((m) => m._eventId === eventId);
    if (messageIndex === -1) return false;

    for (const [startIndex, group] of systemGroupsMap) {
      if (
        messageIndex >= startIndex &&
        messageIndex < startIndex + group.count
      ) {
        return expandedSystemGroups.has(group.firstMessage._eventId!);
      }
    }
    return false;
  };

  // Check if the last message in a system group contains "Pls retry"
  const shouldShowGroupRetryButton = (eventId: string): boolean => {
    // Find the group by eventId (which is the first message's eventId)
    let group: { firstMessage: Message; count: number } | undefined;
    let startIndex: number | undefined;

    for (const [idx, g] of systemGroupsMap) {
      if (g.firstMessage._eventId === eventId) {
        group = g;
        startIndex = idx;
        break;
      }
    }

    if (!group || startIndex === undefined) return false;

    const lastMessageIndex = startIndex + group.count - 1;
    const lastMessage = messages[lastMessageIndex];

    if (lastMessage && lastMessage.role === "system") {
      const textContent = getTextFromContent(lastMessage.content);
      return textContent.includes("Pls retry");
    }

    return false;
  };

  const copyMessageContent = async (
    messageIndex: number,
    content: string | MessageContent[]
  ) => {
    try {
      const textContent = getTextFromContent(content);
      await navigator.clipboard.writeText(textContent);
      setCopiedMessageIndex(messageIndex);
      setTimeout(() => setCopiedMessageIndex(null), 2000);
    } catch (error) {
      console.error("Failed to copy message:", error);
    }
  };

  const handleSaveInlineEdit = () => {
    if (editingMessageIndex !== null) {
      setSelectedVersions((prev) => {
        const newMap = new Map(prev);
        Array.from(newMap.keys()).forEach((key) => {
          if (key >= editingMessageIndex) {
            newMap.delete(key);
          }
        });
        return newMap;
      });
    }
    saveInlineEdit();
  };

  // Calculate the bottom padding needed for the input area
  const bottomPadding = Math.max(
    (textareaHeight ?? 48) + 48,
    isMobile ? 96 : 120
  );

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto flex flex-col"
      style={{
        paddingTop: "calc(60px + env(safe-area-inset-top))",
      }}
    >
      <div className="mx-auto w-full max-w-[44rem] px-4 sm:px-6 lg:px-0 py-4 md:py-2 flex flex-col min-h-full">
        {/* Messages container - doesn't grow, just takes natural height */}
        <div className="shrink-0">
          {messageVersions.size === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 min-h-[calc(100vh-200px)]">
              {/* Greeting message will be handled by the input component when centered */}
            </div>
          ) : (
            Array.from({ length: messageVersions.size }, (_, index) => {
              const versions = messageVersions.get(index);
              if (!versions || versions.length === 0) return null;

              // Use the first message in the versions array as the original message
              const originalMessage = versions[versions.length - 1];

              // Determine which version of the message to display
              const {
                msg: message,
                currentVersion,
                totalVersions,
              } = getMessageToDisplay(originalMessage, index);

              // Check if this message represents a system message group
              // We need to match by the message itself, not by index
              const messageIndex = messages.findIndex(
                (m) => m._eventId === message._eventId
              );
              const systemGroup = systemGroupsMap.get(messageIndex);

              const isSystemGroupStart =
                systemGroup &&
                message.role === "system" &&
                !shouldAlwaysShowSystemMessage(message.content);

              return (
                <div key={`msg-${index}-${originalMessage._eventId}`}>
                  <div className="mb-8 last:mb-0">
                    {message.role === "user" ? (
                      <>
                        <div className="flex justify-end mb-2">
                          <VersionNavigator
                            currentVersion={currentVersion}
                            totalVersions={totalVersions}
                            onNavigate={(direction) =>
                              handleVersionChange(
                                index,
                                direction,
                                originalMessage._eventId!
                              )
                            }
                            className="mr-2"
                          />
                        </div>
                        <div className="flex justify-end mb-6">
                          <div
                            className={`${
                              editingMessageIndex === index
                                ? "w-full sm:max-w-[90%] md:max-w-[85%] lg:max-w-[75%] xl:max-w-[70%]"
                                : "max-w-[85%]"
                            } wrap-break-word break-all`}
                          >
                            {editingMessageIndex === index ? (
                              <div className="flex flex-col w-full">
                                {/* Show existing attachments that will be preserved */}
                                {typeof message.content !== "string" && (
                                  <>
                                    {message.content.filter(
                                      (item) => item.type === "image_url"
                                    ).length > 0 && (
                                      <div className="flex flex-wrap gap-2 mb-2">
                                        {message.content
                                          .filter(
                                            (item) => item.type === "image_url"
                                          )
                                          .map((item, imgIndex) => (
                                            <img
                                              key={`edit-img-${imgIndex}`}
                                              src={item.image_url?.url}
                                              alt="Attached"
                                              className="w-16 h-16 object-cover rounded-lg border border-border"
                                            />
                                          ))}
                                      </div>
                                    )}
                                    {message.content.filter(
                                      (item) => item.type === "file"
                                    ).length > 0 && (
                                      <div className="flex flex-wrap gap-2 mb-2">
                                        {message.content
                                          .filter(
                                            (item) => item.type === "file"
                                          )
                                          .map((item, fileIndex) => (
                                            <div
                                              key={`edit-file-${fileIndex}`}
                                              className="flex w-[220px] max-w-full h-16 items-center gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2"
                                            >
                                              <FileText
                                                className="h-5 w-5 text-foreground/80 shrink-0"
                                                aria-hidden="true"
                                              />
                                              <div className="min-w-0 flex-1">
                                                <p
                                                  className="truncate text-sm font-medium text-foreground"
                                                  title={
                                                    item.file?.name ||
                                                    "Attachment"
                                                  }
                                                >
                                                  {item.file?.name ||
                                                    "Attachment"}
                                                </p>
                                                {item.file?.mimeType && (
                                                  <p className="text-xs uppercase text-muted-foreground">
                                                    {item.file.mimeType ===
                                                    "application/pdf"
                                                      ? "PDF"
                                                      : item.file.mimeType.toUpperCase()}
                                                  </p>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                      </div>
                                    )}
                                  </>
                                )}
                                <textarea
                                  value={editingContent}
                                  onChange={(e) =>
                                    setEditingContent(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                      e.preventDefault();
                                      handleSaveInlineEdit();
                                    }
                                  }}
                                  className="w-full bg-muted/50 border border-border rounded-2xl p-3 text-sm text-foreground focus:outline-none focus:border-foreground/40"
                                  rows={3}
                                  autoFocus
                                />
                                <div className="flex justify-end space-x-2 mt-2">
                                  <button
                                    onClick={cancelEditing}
                                    className="text-xs text-muted-foreground hover:text-foreground bg-muted px-3 py-1.5 rounded-md"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={handleSaveInlineEdit}
                                    disabled={isLoading}
                                    className="text-xs text-primary-foreground bg-primary px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    Send
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div className="group relative">
                                  <div className="bg-muted rounded-2xl py-2 px-4 text-foreground">
                                    <div className="text-[18px]">
                                      <MessageContentRenderer
                                        content={message.content}
                                        citations={getCitationsFromContent(
                                          message.content
                                        )}
                                        annotations={getAnnotationsFromContent(
                                          message.content
                                        )}
                                      />
                                    </div>
                                  </div>
                                  <div
                                    className={`flex justify-end items-center gap-2 mt-1 ${
                                      isMobile
                                        ? "opacity-100"
                                        : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                                    } transition-opacity duration-200`}
                                  >
                                    <button
                                      onClick={() =>
                                        copyMessageContent(
                                          index,
                                          message.content
                                        )
                                      }
                                      className="p-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                      aria-label="Copy message"
                                    >
                                      {copiedMessageIndex === index ? (
                                        <Check className="w-4 h-4" />
                                      ) : (
                                        <Copy className="w-4 h-4" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => startEditingMessage(index)}
                                      className="p-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                      aria-label="Edit message"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    ) : message.role === "system" ? (
                      <>
                        <div className="flex justify-center mb-2">
                          <VersionNavigator
                            currentVersion={currentVersion}
                            totalVersions={totalVersions}
                            onNavigate={(direction) =>
                              handleVersionChange(
                                index,
                                direction,
                                originalMessage._eventId!
                              )
                            }
                            className=""
                          />
                        </div>
                        {/* Show toggle button at the start of each system message group */}
                        {isSystemGroupStart && (
                          <div className="flex justify-center items-center gap-3 mb-6">
                            {!expandedSystemGroups.has(
                              systemGroup.firstMessage._eventId!
                            ) ? (
                              <button
                                onClick={() =>
                                  toggleSystemGroup(
                                    systemGroup.firstMessage._eventId!
                                  )
                                }
                                className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-1.5 transition-colors"
                              >
                                <Eye className="w-3 h-3" />
                                Show {systemGroup.count} Error
                                {systemGroup.count === 1 ? "" : "s"}
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  toggleSystemGroup(
                                    systemGroup.firstMessage._eventId!
                                  )
                                }
                                className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300 bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-1.5 transition-colors"
                              >
                                <EyeOff className="w-3 h-3" />
                                Hide Errors
                              </button>
                            )}
                          </div>
                        )}

                        {/* Check if this system message should always be shown or if it's in an expanded group */}
                        {(() => {
                          // Determine which messages to render
                          const messagesToRender: Array<{
                            msg: Message;
                            idx: number;
                          }> =
                            systemGroup &&
                            systemGroup.count > 1 &&
                            expandedSystemGroups.has(
                              systemGroup.firstMessage._eventId!
                            )
                              ? Array.from(
                                  { length: systemGroup.count },
                                  (_, i) => ({
                                    msg: messages[messageIndex + i],
                                    idx: messageIndex + i,
                                  })
                                ).filter((item) => item.msg)
                              : [{ msg: message, idx: index }];

                          // Check if we should render - either if any message should always be shown or if in expanded group
                          const shouldRender =
                            messagesToRender.some(({ msg }) =>
                              shouldAlwaysShowSystemMessage(msg.content)
                            ) || isInExpandedGroup(message._eventId);

                          if (!shouldRender) return null;

                          return messagesToRender.map(
                            ({ msg, idx }, renderIdx) => (
                              <div
                                key={`system-${messageIndex}-${renderIdx}`}
                                className="flex justify-center mb-6 group"
                              >
                                <div className="flex flex-col">
                                  <div className="bg-red-100 dark:bg-red-500/20 border border-red-200 dark:border-red-500/30 rounded-lg py-3 px-4 text-red-800 dark:text-red-200 max-w-full overflow-x-hidden">
                                    <div className="flex items-start gap-2 min-w-0">
                                      <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="text-red-600 dark:text-red-300 mt-0.5 shrink-0"
                                      >
                                        <path
                                          d="M12 9v4M12 21h.01M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                      <div className="text-sm font-medium min-w-0">
                                        {getTextFromContent(msg.content)
                                          .split("\n")
                                          .map((line, lineIdx) => (
                                            <div
                                              key={lineIdx}
                                              className="wrap-break-word break-all"
                                            >
                                              {line}
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  </div>
                                  <div
                                    className={`mt-1.5 ${
                                      isMobile
                                        ? "opacity-100"
                                        : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                                    } transition-opacity duration-200`}
                                  >
                                    <button
                                      onClick={() => retryMessage(idx)}
                                      className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-200 bg-red-100 dark:bg-red-500/20 hover:bg-red-200 dark:hover:bg-red-500/30 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-1.5 transition-colors cursor-pointer"
                                    >
                                      <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="rotate-45"
                                      >
                                        <path
                                          d="M21.168 8A10.003 10.003 0 0 0 12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                        />
                                        <path
                                          d="M17 8h4.4a.6.6 0 0 0 .6-.6V3"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                      Retry
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <div className="flex justify-start mb-2">
                          <VersionNavigator
                            currentVersion={currentVersion}
                            totalVersions={totalVersions}
                            onNavigate={(direction) =>
                              handleVersionChange(
                                index,
                                direction,
                                originalMessage._eventId!
                              )
                            }
                            className="ml-2"
                          />
                        </div>
                        <div className="flex flex-col items-start mb-6 group">
                          {(() => {
                            return null;
                          })()}
                          {getThinkingFromContent(message.content) && (
                            <ThinkingSection
                              thinking={
                                getThinkingFromContent(message.content)!
                              }
                              thinkingContent={thinkingContent}
                            />
                          )}
                          <div className="w-full text-foreground py-2 px-0 text-[18px]">
                            <MessageContentRenderer
                              content={message.content}
                              citations={getCitationsFromContent(
                                message.content
                              )}
                              annotations={getAnnotationsFromContent(
                                message.content
                              )}
                            />
                          </div>
                          <div
                            className={`mt-1.5 ${
                              isMobile
                                ? "opacity-100"
                                : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                            } transition-opacity duration-200 flex items-center gap-2`}
                          >
                            <button
                              onClick={() =>
                                copyMessageContent(index, message.content)
                              }
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border rounded-md px-3 py-1.5 transition-colors cursor-pointer"
                            >
                              {copiedMessageIndex === index ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copiedMessageIndex === index
                                ? "Copied!"
                                : "Copy"}
                            </button>
                            <button
                              onClick={() => retryMessage(index)}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border rounded-md px-3 py-1.5 transition-colors cursor-pointer"
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                className="rotate-45"
                              >
                                <path
                                  d="M21.168 8A10.003 10.003 0 0 0 12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                />
                                <path
                                  d="M17 8h4.4a.6.6 0 0 0 .6-.6V3"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              Try Again
                            </button>
                            {message.satsSpent !== undefined &&
                              message.satsSpent > 0 && (
                                <span className="flex items-center gap-1 text-xs text-amber-400/80 px-2 py-1">
                                  - ₿
                                  {message.satsSpent.toFixed(
                                    message.satsSpent < 1 ? 3 : 0
                                  )}
                                </span>
                              )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {thinkingContent && (
            <ThinkingSection
              thinkingContent={thinkingContent}
              isStreaming={streamingContent == ""}
            />
          )}

          {streamingContent && (
            <div className="flex flex-col items-start mb-6">
              <div className="w-full text-foreground py-2 px-0 text-[18px]">
                <MarkdownRenderer content={streamingContent} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
        {/* Flexible spacer - grows to fill space when content is short, has min-height for input area */}
        <div
          className="grow"
          style={{
            minHeight: `calc(${bottomPadding}px + env(safe-area-inset-bottom))`,
          }}
        />
      </div>
    </div>
  );
}
