import { Message, MessageContent } from '@/types/chat';
import { Edit, MessageSquare, Copy, Check, Eye, EyeOff } from 'lucide-react';
import MessageContentRenderer from '@/components/MessageContent';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import ThinkingSection from '@/components/ui/ThinkingSection';
import { RefObject, useState, useEffect, useRef, useCallback } from 'react';

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
  isMobile
}: ChatMessagesProps) {
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [expandedSystemGroups, setExpandedSystemGroups] = useState<Set<number>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);

  const isScrolledToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    const thresholdPx = 24;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - thresholdPx;
  }, []);

  const handleScroll = useCallback(() => {
    setIsUserAtBottom(isScrolledToBottom());
  }, [isScrolledToBottom]);

  const scrollToBottomIfNeeded = useCallback(() => {
    if (isUserAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [isUserAtBottom, messagesEndRef]);

  useEffect(() => {
    // Initial check on mount
    setIsUserAtBottom(isScrolledToBottom());
  }, [isScrolledToBottom]);

  useEffect(() => {
    scrollToBottomIfNeeded();
  }, [messages.length, streamingContent, thinkingContent, scrollToBottomIfNeeded]);

  // Helper function to check if a system message should always be shown
  const shouldAlwaysShowSystemMessage = (content: string | MessageContent[]): boolean => {
    const textContent = getTextFromContent(content);
    return textContent.trim().startsWith('ATTENTION');
  };

  // Function to identify system message groups
  const getSystemMessageGroups = () => {
    const groups: { startIndex: number; count: number }[] = [];
    let currentGroupStart: number | null = null;
    let currentGroupCount = 0;

    messages.forEach((message, index) => {
      if (message.role === 'system' && !shouldAlwaysShowSystemMessage(message.content)) {
        if (currentGroupStart === null) {
          currentGroupStart = index;
          currentGroupCount = 1;
        } else {
          currentGroupCount++;
        }
      } else {
        if (currentGroupStart !== null) {
          groups.push({ startIndex: currentGroupStart, count: currentGroupCount });
          currentGroupStart = null;
          currentGroupCount = 0;
        }
      }
    });

    // Don't forget the last group if it ends at the last message
    if (currentGroupStart !== null) {
      groups.push({ startIndex: currentGroupStart, count: currentGroupCount });
    }

    return groups;
  };

  const systemGroups = getSystemMessageGroups();

  // Toggle a specific system message group
  const toggleSystemGroup = (groupStartIndex: number) => {
    setExpandedSystemGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupStartIndex)) {
        newSet.delete(groupStartIndex);
      } else {
        newSet.add(groupStartIndex);
      }
      return newSet;
    });
  };

  // Check if a message belongs to an expanded group
  const isInExpandedGroup = (messageIndex: number): boolean => {
    const group = systemGroups.find(g =>
      messageIndex >= g.startIndex && messageIndex < g.startIndex + g.count
    );
    return group ? expandedSystemGroups.has(group.startIndex) : false;
  };

  // Check if the last message in a system group contains "Pls retry"
  const shouldShowGroupRetryButton = (groupStartIndex: number): boolean => {
    const group = systemGroups.find(g => g.startIndex === groupStartIndex);
    if (!group) return false;

    const lastMessageIndex = group.startIndex + group.count - 1;
    const lastMessage = messages[lastMessageIndex];

    if (lastMessage && lastMessage.role === 'system') {
      const textContent = getTextFromContent(lastMessage.content);
      return textContent.includes('Pls retry');
    }

    return false;
  };

  const copyMessageContent = async (messageIndex: number, content: string | MessageContent[]) => {
    try {
      const textContent = getTextFromContent(content);
      await navigator.clipboard.writeText(textContent);
      setCopiedMessageIndex(messageIndex);
      setTimeout(() => setCopiedMessageIndex(null), 2000);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  };
  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-y-auto pt-[60px] ${isMobile ? 'pb-4' : 'pb-[80px]'}`}
      style={{
        paddingTop: 'calc(60px + env(safe-area-inset-top))',
        paddingBottom: isMobile
          ? 'calc(16px + env(safe-area-inset-bottom))'
          : 'calc(80px + env(safe-area-inset-bottom))'
      }}
    >
      <div className="mx-auto w-full max-w-4xl px-4 md:px-6 py-4 md:py-10">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 min-h-[calc(100vh-200px)]">
            {/* Greeting message will be handled by the input component when centered */}
          </div>
        ) : (
          messages.map((message, index) => {
            // Check if this is the start of a system message group
            const systemGroup = systemGroups.find(g => g.startIndex === index);
            const isSystemGroupStart = systemGroup &&
              message.role === 'system' &&
              !shouldAlwaysShowSystemMessage(message.content);

            return (
              <div key={index}>
                {/* Show toggle button at the start of each system message group */}
                {isSystemGroupStart && (
                  <div className="flex justify-center items-center gap-3 mb-6">
                    {!expandedSystemGroups.has(index) ? (
                      <button
                        onClick={() => toggleSystemGroup(index)}
                        className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-md px-3 py-1.5 transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        Show {systemGroup.count} Error{systemGroup.count === 1 ? '' : 's'}
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleSystemGroup(index)}
                        className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-md px-3 py-1.5 transition-colors"
                      >
                        <EyeOff className="w-3 h-3" />
                        Hide Errors
                      </button>
                    )}

                    {/* Show retry button if last message contains "Pls retry" */}
                    {shouldShowGroupRetryButton(index) && (
                      <button
                        onClick={() => retryMessage(index + systemGroup.count - 1)}
                        className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-md px-3 py-1.5 transition-colors"
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
                    )}
                  </div>
                )}

                <div className="mb-8 last:mb-0">
                  {message.role === 'user' ? (
                    <div className="flex justify-end mb-6">
                      <div className="max-w-[85%] break-words break-all">
                        {editingMessageIndex === index ? (
                          <div className="flex flex-col w-full">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded p-3 text-sm text-white focus:outline-none focus:border-white/40"
                              rows={3}
                              autoFocus
                            />
                            <div className="flex justify-end space-x-2 mt-2">
                              <button
                                onClick={cancelEditing}
                                className="text-xs text-gray-300 hover:text-white bg-white/10 px-3 py-1.5 rounded"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={saveInlineEdit}
                                className="text-xs text-white bg-black px-3 py-1.5 rounded hover:bg-black/80"
                              >
                                Save & Send
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="group relative">
                              <div className="bg-gray-700/70 rounded-2xl py-3 px-4 text-white">
                                <div className="text-sm">
                                  <MessageContentRenderer content={message.content} />
                                </div>
                              </div>
                              <div className="flex justify-end mt-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
                                <button
                                  onClick={() => startEditingMessage(index)}
                                  className="p-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                                  aria-label="Edit message"
                                >
                                  <Edit className="w-3 h-3 text-white/70" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : message.role === 'system' ? (
                    // Check if this system message should always be shown or if it's in an expanded group
                    (shouldAlwaysShowSystemMessage(message.content) || isInExpandedGroup(index)) ? (
                      <div className="flex justify-center mb-6 group">
                        <div className="flex flex-col">
                          <div className="bg-red-500/20 border border-red-500/30 rounded-lg py-3 px-4 text-red-200 max-w-full overflow-x-hidden">
                            <div className="flex items-start gap-2 min-w-0">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-red-300 mt-0.5 flex-shrink-0">
                                <path d="M12 9v4M12 21h.01M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                              <div className="text-sm font-medium min-w-0">
                                {getTextFromContent(message.content).split('\n').map((line, idx) => (
                                  <div key={idx} className="break-words break-all">{line}</div>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="mt-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
                            <button
                              onClick={() => retryMessage(index)}
                              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-black/50 hover:bg-black/70 rounded-md px-3 py-1.5 transition-colors cursor-pointer"
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
                    ) : null // Don't render if system message is hidden
                  ) : (
                    <div className="flex flex-col items-start mb-6 group">
                      {(message.thinking) && (
                        <ThinkingSection thinking={message.thinking} thinkingContent={thinkingContent} />
                      )}
                      <div className="max-w-[95%] text-gray-100 py-2 px-0.5">
                        <MessageContentRenderer content={message.content} />
                      </div>
                      <div className="mt-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-2">
                        <button
                          onClick={() => copyMessageContent(index, message.content)}
                          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-black/50 hover:bg-black/70 rounded-md px-3 py-1.5 transition-colors cursor-pointer"
                        >
                          {copiedMessageIndex === index ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          {copiedMessageIndex === index ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                          onClick={() => retryMessage(index)}
                          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-black/50 hover:bg-black/70 rounded-md px-3 py-1.5 transition-colors cursor-pointer"
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
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}


        {thinkingContent && (
          <ThinkingSection thinkingContent={thinkingContent} isStreaming={streamingContent == ''} />
        )}

        {streamingContent && (
          <div className="flex flex-col items-start mb-6">
            <div className="max-w-[95%] text-gray-100 py-2 px-0.5">
              <MarkdownRenderer content={streamingContent} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}