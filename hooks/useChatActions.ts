import { useState, useCallback, useRef, useEffect } from "react";
import {
  Message,
  MessageContent,
  MessageAttachment,
  TransactionHistory,
} from "@/types/chat";
import {
  createTextMessage,
  createMultimodalMessage,
} from "@/utils/messageUtils";
import { fetchAIResponse } from "@/utils/apiUtils";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import { useCashuWithXYZ } from "./useCashuWithXYZ";
import { DEFAULT_MINT_URL } from "@/lib/utils";

export interface UseChatActionsReturn {
  inputMessage: string;
  isLoading: boolean;
  streamingContent: string; // legacy, not used by UI after per-conv streaming
  thinkingContent: string; // legacy, not used by UI after per-conv streaming
  streamingConversationId: string | null;
  getStreamingContentFor: (conversationId: string | null) => string;
  getThinkingContentFor: (conversationId: string | null) => string;
  balance: number;
  currentMintUnit: string;
  mintBalances: Record<string, number>;
  mintUnits: Record<string, string>;
  isBalanceLoading: boolean;
  uploadedAttachments: MessageAttachment[];
  transactionHistory: TransactionHistory[];
  hotTokenBalance: number;
  usingNip60: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  setInputMessage: (message: string) => void;
  setIsLoading: (loading: boolean) => void;
  setStreamingContent: (content: string) => void;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  setUploadedAttachments: React.Dispatch<
    React.SetStateAction<MessageAttachment[]>
  >;
  setTransactionHistory: React.Dispatch<
    React.SetStateAction<TransactionHistory[]>
  >;
  sendMessage: (
    messages: Message[],
    setMessages: (messages: Message[]) => void,
    activeConversationId: string | null,
    selectedModel: any,
    baseUrl: string,
    isAuthenticated: boolean,
    setIsLoginModalOpen: (open: boolean) => void,
    getActiveConversationId: () => string | null
  ) => Promise<void>;
  saveInlineEdit: (
    editingMessageIndex: number | null,
    editingContent: string,
    messages: Message[],
    setMessages: (messages: Message[]) => void,
    setEditingMessageIndex: (index: number | null) => void,
    setEditingContent: (content: string) => void,
    selectedModel: any,
    baseUrl: string,
    activeConversationId: string | null,
    getActiveConversationId: () => string | null
  ) => Promise<void>;
  retryMessage: (
    index: number,
    messages: Message[],
    setMessages: (messages: Message[]) => void,
    selectedModel: any,
    baseUrl: string,
    activeConversationId: string | null,
    getActiveConversationId: () => string | null
  ) => void;
}

export interface UseChatActionsParams {
  createAndStoreChatEvent: (
    conversationId: string,
    message: Message
  ) => Promise<string | null>;
  getLastNonSystemMessageEventId: (
    conversationId: string,
    lastMessageRole?: string[]
  ) => string;
  updateLastMessageSatsSpent: (
    conversationId: string,
    satsSpent: number
  ) => void;
}

/**
 * Custom hook for handling chat operations and AI interactions
 * Manages message sending logic, AI response streaming,
 * token management for API calls, and error handling and retries
 */
export const useChatActions = ({
  createAndStoreChatEvent,
  getLastNonSystemMessageEventId,
  updateLastMessageSatsSpent,
}: UseChatActionsParams): UseChatActionsReturn => {
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [thinkingContent, setThinkingContent] = useState("");
  const [streamingConversationId, setStreamingConversationId] = useState<
    string | null
  >(null);
  const streamingConversationIdRef = useRef<string | null>(null);
  const [streamingContentByConversation, setStreamingContentByConversation] =
    useState<Record<string, string>>({});
  const [thinkingContentByConversation, setThinkingContentByConversation] =
    useState<Record<string, string>>({});
  const getStreamingContentFor = useCallback(
    (conversationId: string | null) => {
      if (!conversationId) return "";
      return streamingContentByConversation[conversationId] ?? "";
    },
    [streamingContentByConversation]
  );
  const getThinkingContentFor = useCallback(
    (conversationId: string | null) => {
      if (!conversationId) return "";
      return thinkingContentByConversation[conversationId] ?? "";
    },
    [thinkingContentByConversation]
  );
  const [uploadedAttachments, setUploadedAttachments] = useState<
    MessageAttachment[]
  >([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Get all balance and wallet functionality from useCashuWithXYZ
  const {
    balance,
    setBalance,
    currentMintUnit,
    mintBalances,
    mintUnits,
    isBalanceLoading,
    setPendingCashuAmountState,
    transactionHistory,
    setTransactionHistory,
    hotTokenBalance,
    usingNip60,
    spendCashu,
    storeCashu,
    cashuStore,
  } = useCashuWithXYZ();

  // Autoscroll moved to ChatMessages to honor user scroll position

  const sendMessage = useCallback(
    async (
      messages: Message[],
      setMessages: (messages: Message[]) => void,
      activeConversationId: string | null,
      selectedModel: any,
      baseUrl: string,
      isAuthenticated: boolean,
      setIsLoginModalOpen: (open: boolean) => void,
      getActiveConversationId: () => string | null
    ) => {
      if (!isAuthenticated) {
        setIsLoginModalOpen(true);
        return;
      }

      if (!inputMessage.trim() && uploadedAttachments.length === 0) return;

      const prevId = activeConversationId
        ? getLastNonSystemMessageEventId(activeConversationId)
        : "0".repeat(64);

      // Create user message with text and images
      const userMessage =
        uploadedAttachments.length > 0
          ? createMultimodalMessage("user", inputMessage, uploadedAttachments)
          : createTextMessage("user", inputMessage);

      const timestamp = Date.now();

      const updatedMessage = {
        ...userMessage,
        _prevId: prevId,
        _createdAt: timestamp,
      };

      const originConversationId = activeConversationId ?? timestamp.toString();
      const updatedMessages = [...messages, updatedMessage];

      // The _prevId is already set in the userMessage from our getLastNonSystemMessagePrevId function
      createAndStoreChatEvent(originConversationId, updatedMessage).catch(
        console.error
      );

      setInputMessage("");
      setUploadedAttachments([]);

      await performAIRequest(
        updatedMessages,
        setMessages,
        selectedModel,
        baseUrl,
        originConversationId
      );
    },
    [
      inputMessage,
      uploadedAttachments,
      getLastNonSystemMessageEventId,
      createAndStoreChatEvent,
    ]
  );

  const saveInlineEdit = useCallback(
    async (
      editingMessageIndex: number | null,
      editingContent: string,
      messages: Message[],
      setMessages: (messages: Message[]) => void,
      setEditingMessageIndex: (index: number | null) => void,
      setEditingContent: (content: string) => void,
      selectedModel: any,
      baseUrl: string,
      activeConversationId: string | null,
      getActiveConversationId: () => string | null
    ) => {
      if (editingMessageIndex !== null && editingContent.trim()) {
        const updatedMessages = [...messages];
        const originalMessage = updatedMessages[editingMessageIndex];

        // Preserve attachments from original message
        let newContent: string | MessageContent[];
        if (typeof originalMessage.content === "string") {
          // Simple case: was just text, remains just text
          newContent = editingContent;
        } else {
          // Complex case: preserve attachments and hidden text, update the visible text
          const updatedContent: MessageContent[] = [];
          let textReplaced = false;

          originalMessage.content.forEach((item) => {
            if (item.type === "text" && !item.hidden) {
              if (!textReplaced) {
                updatedContent.push({ ...item, text: editingContent });
                textReplaced = true;
              }
              return;
            }
            updatedContent.push(item);
          });

          if (!textReplaced) {
            updatedContent.unshift({ type: "text", text: editingContent });
          }

          newContent = updatedContent;
        }

        updatedMessages[editingMessageIndex] = {
          ...originalMessage,
          content: newContent,
        };

        const truncatedMessages = updatedMessages.slice(
          0,
          editingMessageIndex + 1
        );

        setMessages(truncatedMessages);
        setEditingMessageIndex(null);
        setEditingContent("");

        const originConversationId =
          activeConversationId ?? getActiveConversationId();
        if (!originConversationId) {
          throw new Error("No active conversation ID found");
        }
        console.log(
          truncatedMessages[truncatedMessages.length - 1],
          truncatedMessages
        );
        createAndStoreChatEvent(
          originConversationId,
          truncatedMessages[truncatedMessages.length - 1]
        ).catch(console.error);
        await performAIRequest(
          truncatedMessages,
          setMessages,
          selectedModel,
          baseUrl,
          originConversationId
        );
      }
    },
    []
  );

  const retryMessage = useCallback(
    (
      index: number,
      messages: Message[],
      setMessages: (messages: Message[]) => void,
      selectedModel: any,
      baseUrl: string,
      activeConversationId: string | null,
      getActiveConversationId: () => string | null
    ) => {
      const newMessages = messages.slice(0, index);
      setMessages(newMessages);
      const originConversationId =
        activeConversationId ?? getActiveConversationId();
      if (!originConversationId) {
        throw new Error("No active conversation ID found");
      }
      performAIRequest(
        newMessages,
        setMessages,
        selectedModel,
        baseUrl,
        originConversationId,
        true
      );
    },
    []
  );

  const performAIRequest = useCallback(
    async (
      messageHistory: Message[],
      setMessages: (messages: Message[]) => void,
      selectedModel: any,
      baseUrl: string,
      originConversationId: string,
      retryMessage?: boolean
    ) => {
      setIsLoading(true);
      setStreamingContent("");
      setThinkingContent("");
      setStreamingConversationId(originConversationId ?? null);
      streamingConversationIdRef.current = originConversationId ?? null;
      if (originConversationId) {
        setStreamingContentByConversation((prev) => ({
          ...prev,
          [originConversationId]: "",
        }));
        setThinkingContentByConversation((prev) => ({
          ...prev,
          [originConversationId]: "",
        }));
      }

      try {
        const mintUrl = cashuStore.activeMintUrl || DEFAULT_MINT_URL;
        await fetchAIResponse({
          messageHistory,
          selectedModel,
          baseUrl,
          mintUrl,
          usingNip60,
          balance,
          spendCashu: spendCashu,
          storeCashu: storeCashu,
          activeMintUrl: cashuStore.activeMintUrl,
          onStreamingUpdate: (content) => {
            // Ignore stale updates from previous streams
            if (
              streamingConversationIdRef.current !==
              (originConversationId ?? null)
            )
              return;
            if (originConversationId) {
              setStreamingContentByConversation((prev) => ({
                ...prev,
                [originConversationId]: content,
              }));
            }
          },
          onThinkingUpdate: (content) => {
            if (
              streamingConversationIdRef.current !==
              (originConversationId ?? null)
            )
              return;
            if (originConversationId) {
              setThinkingContentByConversation((prev) => ({
                ...prev,
                [originConversationId]: content,
              }));
            }
          },
          onMessageAppend: (message) => {
            let prevId;
            if (retryMessage && message.role !== "system")
              prevId = getLastNonSystemMessageEventId(originConversationId, [
                "user",
                "assistant",
              ]);
            else prevId = getLastNonSystemMessageEventId(originConversationId);

            // Update message object with prevId
            const updatedMessage = {
              ...message,
              _prevId: prevId,
              _createdAt: Date.now(),
              _modelId: selectedModel.id,
            };

            // Publish AI response to Nostr
            if (originConversationId) {
              createAndStoreChatEvent(
                originConversationId,
                updatedMessage
              ).catch(console.error);
            }
          },
          onBalanceUpdate: setBalance,
          onTransactionUpdate: (transaction) => {
            const updated = [...transactionHistory, transaction];
            setTransactionHistory(updated);
            return updated;
          },
          transactionHistory,
          onTokenCreated: setPendingCashuAmountState,
          onLastMessageSatsUpdate: (satsSpent) => {
            updateLastMessageSatsSpent(originConversationId, satsSpent);
          },
        });
        setPendingCashuAmountState(getPendingCashuTokenAmount());
      } finally {
        setIsLoading(false);
        setStreamingContent("");
        setThinkingContent("");
        setStreamingConversationId(null);
        streamingConversationIdRef.current = null;
        if (originConversationId) {
          setStreamingContentByConversation((prev) => ({
            ...prev,
            [originConversationId]: "",
          }));
          setThinkingContentByConversation((prev) => ({
            ...prev,
            [originConversationId]: "",
          }));
        }
      }
    },
    [
      usingNip60,
      balance,
      spendCashu,
      storeCashu,
      transactionHistory,
      setPendingCashuAmountState,
      updateLastMessageSatsSpent,
      getLastNonSystemMessageEventId,
      createAndStoreChatEvent,
      cashuStore.activeMintUrl,
    ]
  );

  return {
    inputMessage,
    isLoading,
    streamingContent,
    thinkingContent,
    streamingConversationId,
    getStreamingContentFor,
    getThinkingContentFor,
    balance,
    currentMintUnit,
    mintBalances,
    mintUnits,
    isBalanceLoading,
    uploadedAttachments,
    transactionHistory,
    hotTokenBalance,
    usingNip60,
    messagesEndRef,
    setInputMessage,
    setIsLoading,
    setStreamingContent,
    setBalance: setBalance,
    setUploadedAttachments,
    setTransactionHistory,
    sendMessage,
    saveInlineEdit,
    retryMessage,
  };
};
