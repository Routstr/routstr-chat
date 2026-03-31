"use client";

import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessageSquareText, Search } from "lucide-react";
import CloseButton from "@/components/ui/CloseButton";
import { ModalShell } from "@/components/ui/ModalShell";
import { cn } from "@/lib/utils";
import { Conversation } from "@/types/chat";
import { getTextFromContent } from "@/utils/messageUtils";

interface ChatSearchOverlayProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
}

interface SearchResult {
  conversation: Conversation;
  snippet: string;
  matchesTitle: boolean;
}

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const truncateText = (value: string, maxLength = 140): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
};

const createSnippet = (value: string, query: string): string => {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "No searchable messages in this chat yet.";
  }

  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return truncateText(normalizedValue);
  }

  const lowerValue = normalizedValue.toLowerCase();
  const matchIndex = lowerValue.indexOf(normalizedQuery);
  if (matchIndex === -1) {
    return truncateText(normalizedValue);
  }

  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(
    normalizedValue.length,
    matchIndex + normalizedQuery.length + 92
  );

  return `${start > 0 ? "..." : ""}${normalizedValue.slice(start, end)}${
    end < normalizedValue.length ? "..." : ""
  }`;
};

const getSearchableMessages = (conversation: Conversation): string[] =>
  conversation.messages
    .map((message) => normalizeText(getTextFromContent(message.content)))
    .filter(Boolean);

const getDefaultSnippet = (searchableMessages: string[]): string => {
  const latestMessage = searchableMessages[searchableMessages.length - 1];

  if (latestMessage) {
    return truncateText(latestMessage);
  }

  return "No searchable messages in this chat yet.";
};

export default function ChatSearchOverlay({
  open,
  onClose,
  conversations,
  activeConversationId,
  onSelectConversation,
}: ChatSearchOverlayProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setQuery("");

    const timerId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  const results = useMemo<SearchResult[]>(() => {
    const normalizedQuery = normalizeText(deferredQuery).toLowerCase();

    return conversations
      .map((conversation) => {
        const normalizedTitle = normalizeText(conversation.title);
        const searchableMessages = getSearchableMessages(conversation);

        if (!normalizedQuery) {
          return {
            conversation,
            snippet: getDefaultSnippet(searchableMessages),
            matchesTitle: false,
          };
        }

        const matchesTitle = normalizedTitle.toLowerCase().includes(
          normalizedQuery
        );
        const matchingMessage = searchableMessages.find((message) =>
          message.toLowerCase().includes(normalizedQuery)
        );

        if (!matchesTitle && !matchingMessage) {
          return null;
        }

        return {
          conversation,
          snippet: createSnippet(matchingMessage ?? normalizedTitle, deferredQuery),
          matchesTitle,
        };
      })
      .filter((result): result is SearchResult => result !== null);
  }, [conversations, deferredQuery]);

  const resultCountLabel =
    deferredQuery.trim().length > 0
      ? `${results.length} match${results.length === 1 ? "" : "es"}`
      : `${conversations.length} chat${conversations.length === 1 ? "" : "s"}`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeOnOverlayClick
      overlayClassName="bg-black/70 backdrop-blur-sm z-[80] p-4"
      contentClassName="w-full max-w-2xl overflow-hidden rounded-2xl border border-sidebar-border bg-background shadow-2xl"
      contentAriaLabel="Search chats"
    >
      <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
        <div className="rounded-full border border-sidebar-border bg-sidebar-accent/30 p-2 text-muted-foreground">
          <Search className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) {
                event.preventDefault();
                onSelectConversation(results[0].conversation.id);
              }
            }}
            placeholder="Search by title or message text"
            className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Search chats by title or message text"
          />
          <p className="mt-1 text-xs text-muted-foreground">{resultCountLabel}</p>
        </div>
        <CloseButton
          onClick={onClose}
          className="rounded-full border border-sidebar-border bg-sidebar-accent/20 p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-foreground"
          iconClassName="h-4 w-4"
          ariaLabel="Close chat search"
        />
      </div>

      <div className="max-h-[min(70vh,640px)] overflow-y-auto p-2">
        {results.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
            <div className="rounded-full border border-sidebar-border bg-sidebar-accent/20 p-3 text-muted-foreground">
              <MessageSquareText className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              {conversations.length === 0 && deferredQuery.trim().length === 0
                ? "No saved chats yet."
                : "No chats matched your search."}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {conversations.length === 0 && deferredQuery.trim().length === 0
                ? "Start a conversation and it will show up here once it is saved."
                : "Try a chat title, prompt text, or part of a reply."}
            </p>
          </div>
        ) : (
          results.map(({ conversation, snippet, matchesTitle }) => {
            const isActive = activeConversationId === conversation.id;

            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelectConversation(conversation.id)}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                  isActive
                    ? "border-sidebar-border bg-sidebar-accent/70"
                    : "border-transparent hover:border-sidebar-border hover:bg-sidebar-accent/30"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-foreground">
                    {conversation.title || "Untitled chat"}
                  </p>
                  <div className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {isActive
                      ? "Open now"
                      : matchesTitle
                        ? "Title match"
                        : "Message match"}
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{snippet}</p>
              </button>
            );
          })
        )}
      </div>
    </ModalShell>
  );
}
