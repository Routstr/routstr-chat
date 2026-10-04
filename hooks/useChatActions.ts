import { useState, useCallback, useRef } from "react";
import {
  Message,
  MessageContent,
  MessageAttachment,
  TransactionHistory,
} from "@/types/chat";
import {
  convertMessageForAPI,
  createTextMessage,
  createMultimodalMessage,
} from "@/utils/messageUtils";
import { getPendingCashuTokenAmount } from "@/utils/cashuUtils";
import { useCashuWithXYZ } from "./useCashuWithXYZ";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { saveFile } from "@/utils/indexedDb";
import { useWalletAdapter } from "./useWalletAdapter";
import { useSdkClient } from "./useSdkClient";
import {
  hydrate as hydrateStore,
  discoveryAdapter,
  storageAdapter,
  modelManager,
  providerManager,
  usageTrackingDriver,
} from "@/sdk/sharedStore";
import { fetchAIResponse, consoleLogger, isTorContext } from "@routstr/sdk";
import { toast } from "sonner";
import { useNodePays } from "@/hooks/useRemoteNode";
import { withNodeModeError } from "@/lib/remoteNode";

export interface UseChatActionsReturn {
  inputMessage: string;
  isLoading: boolean;
  isPaymentProcessing: boolean;
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
  /** Abort the in-flight AI request / stream. */
  stopGeneration: () => void;
  /** Refund all API keys back to the active mint */
  refundAllApiKeys: () => Promise<{
    totalRefunded: number;
    totalFailed: number;
    results: { baseUrl: string; success: boolean }[];
  }>;
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
  /** Called when inference/streaming starts (for keep-alive) */
  onInferenceStart?: () => void;
  /** Called when inference/streaming ends (for keep-alive) */
  onInferenceEnd?: () => void;
  /** Called to upload generated images to Blossom for cross-device sync */
  onBlossomUpload?: (
    file: File
  ) => Promise<{ hash: string; servers: string[] } | null>;
  /** Resolves a Blossom hash to a data URL (cross-device images have no local copy) */
  onBlossomFetch?: (
    hash: string,
    servers?: string[]
  ) => Promise<string | null>;
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
  onInferenceStart,
  onInferenceEnd,
  onBlossomUpload,
  onBlossomFetch,
}: UseChatActionsParams): UseChatActionsReturn => {
  const nodePays = useNodePays();
  // Retry and edit hold closures from earlier renders, so read the mode at
  // call time or a pre-connect closure pays from the wallet.
  const nodePaysRef = useRef(nodePays);
  nodePaysRef.current = nodePays;
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [thinkingContent, setThinkingContent] = useState("");
  const [streamingConversationId, setStreamingConversationId] = useState<
    string | null
  >(null);
  const streamingConversationIdRef = useRef<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // retry/edit capture a stale performAIRequest (empty deps), so the Blossom
  // resolver is read through a ref to always use the current PNS keys.
  const onBlossomFetchRef = useRef(onBlossomFetch);
  onBlossomFetchRef.current = onBlossomFetch;
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
    cashuStore,
    sendToken,
    receiveToken,
  } = useCashuWithXYZ();

  const walletAdapter = useWalletAdapter({
    mintBalances,
    mintUnits,
    cashuStore,
    sendToken,
    receiveToken,
  });
  const { client } = useSdkClient(walletAdapter, "xcashu");

  const dataUrlToFile = useCallback(
    (dataUrl: string, filename: string): File => {
      const arr = dataUrl.split(",");
      const mimeMatch = arr[0]?.match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : "image/png";
      const bstr = atob(arr[1] || "");
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename, { type: mime });
    },
    []
  );

  const enrichAssistantImages = useCallback(
    async (message: Message): Promise<Message> => {
      if (!Array.isArray(message.content)) return message;

      const content = await Promise.all(
        message.content.map(async (item, index) => {
          if (item.type !== "image_url" || !item.image_url?.url) return item;

          const imageUrl = item.image_url.url;
          if (!imageUrl.startsWith("data:")) return item;

          let storageId: string | undefined;
          let blossomHash: string | undefined;
          let blossomServers: string[] | undefined;

          try {
            const file = dataUrlToFile(
              imageUrl,
              `ai-image-${Date.now()}-${index}.png`
            );
            try {
              storageId = await saveFile(file);
            } catch {}

            if (onBlossomUpload) {
              const uploaded = await onBlossomUpload(file);
              if (uploaded) {
                blossomHash = uploaded.hash;
                blossomServers = uploaded.servers;
              }
            }
          } catch {}

          return {
            ...item,
            image_url: {
              ...item.image_url,
              storageId,
              blossomHash,
              blossomServers,
            },
          };
        })
      );

      return { ...message, content };
    },
    [dataUrlToFile, onBlossomUpload]
  );

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
        true,
        // The new response must be a SIBLING of the retried message (same
        // _prevId) or the version navigator renders it stacked below.
        messages[index]?._prevId
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
      retryMessage?: boolean,
      retryPrevId?: string
    ) => {
      const nodePays = nodePaysRef.current;
      setIsLoading(true);
      setStreamingContent("");
      setThinkingContent("");
      setStreamingConversationId(originConversationId ?? null);
      streamingConversationIdRef.current = originConversationId ?? null;
      let lastAppend: Promise<unknown> = Promise.resolve();
      let retryPrevApplied = false;
      // What streamed so far: on Stop the SDK drops it and appends only
      // "Generation stopped.", so it is kept here and stored first.
      let streamed = "";
      const queue = (incoming: Message) => {
        const message = nodePays ? withNodeModeError(incoming) : incoming;
        // Chain appends in arrival order; cost callbacks wait on the
        // chain since both stamp the conversation's LAST stored message.
        lastAppend = lastAppend
          .then(async () => {
            const messageWithImages = await enrichAssistantImages(
              message as Message
            );
            let prevId;
            if (retryMessage && !retryPrevApplied) {
              // Only the retry's first result is the sibling; later
              // appends chain behind it via the normal lookup.
              retryPrevApplied = true;
              prevId =
                retryPrevId ??
                getLastNonSystemMessageEventId(originConversationId, [
                  "user",
                  "assistant",
                ]);
            } else {
              prevId = getLastNonSystemMessageEventId(
                originConversationId
              );
            }

            const updatedMessage = {
              ...messageWithImages,
              _prevId: prevId,
              _createdAt: Date.now(),
              _modelId: selectedModel.id,
            };

            if (originConversationId) {
              await createAndStoreChatEvent(
                originConversationId,
                updatedMessage
              );
            }
            // Message is committed; drop the loading UI now instead of
            // holding the loader through the SDK's payment finalize.
            setIsLoading(false);
            setIsPaymentProcessing(false);
          })
          .catch(console.error);
      };

      // Create a fresh AbortController for this request so the UI can stop
      // generation mid-stream. Aborting causes fetchAIResponse to reject
      // with an AbortError, which it surfaces as a clean "Generation stopped."
      // system message.
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Start keep-alive for background processing
      onInferenceStart?.();
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
        if (!walletAdapter) {
          throw new Error("Wallet adapter is not ready");
        }
        if (!client || !selectedModel) {
          throw new Error("SDK client is not ready");
        }

        // The node's cache entry can be missing here: right after connect the
        // node pass is still queued behind the public sweep, and a refresh
        // pass that lost the write race can prune it. Routing only ever reads
        // the cache, so guarantee the entry now — one request, node only.
        if (nodePays && !discoveryAdapter.getCachedModels()[nodePays.url]?.length) {
          await modelManager.fetchModels([nodePays.url], true);
          if (!discoveryAdapter.getCachedModels()[nodePays.url]?.length) {
            throw new Error("Failed to fetch the node's model list");
          }
        }

        // If the shared ModelManager already has providers + models cached,
        // pass it so resolveRequestContext skips bootstrap+fetchModels entirely
        // (instant path from cache).  On cold start (cache empty) we omit it and
        // let the SDK fall back to the full blocking bootstrap — there is no
        // cached data to serve from, so waiting is the only option.
        const cachedModels = discoveryAdapter.getCachedModels();
        const hasCache =
          modelManager.getBaseUrls().length > 0 &&
          Object.keys(cachedModels).length > 0;

        // setApiKey refuses to overwrite, so replace rather than write.
        if (
          nodePays &&
          storageAdapter.getApiKey(nodePays.url)?.key !== nodePays.apiKey
        ) {
          storageAdapter.removeApiKey(nodePays.url);
          storageAdapter.setApiKey(nodePays.url, nodePays.apiKey);
        }

        // Race hydration against Stop so a stalled media server can't hold the
        // UI; bail before any payment is made.
        const apiMessageHistory = await Promise.race([
          Promise.all(
            messageHistory.map((m) =>
              convertMessageForAPI(m, onBlossomFetchRef.current)
            )
          ),
          new Promise<null>((resolve) => {
            if (abortController.signal.aborted) return resolve(null);
            abortController.signal.addEventListener(
              "abort",
              () => resolve(null),
              { once: true }
            );
          }),
        ]);
        if (abortController.signal.aborted || !apiMessageHistory) return;
        const lastConverted = apiMessageHistory[apiMessageHistory.length - 1];
        if (
          typeof lastConverted?.content === "string" &&
          lastConverted.content.trim() === "" &&
          Array.isArray(messageHistory[messageHistory.length - 1]?.content)
        ) {
          toast.error(
            "This message's attachments could not be loaded, request not sent"
          );
          return;
        }
        const mediaCount = (msgs: { content: string | MessageContent[] }[]) =>
          msgs.reduce(
            (n, m) =>
              n +
              (Array.isArray(m.content)
                ? m.content.filter((i) => i.type !== "text").length
                : 0),
            0
          );
        if (mediaCount(apiMessageHistory) < mediaCount(messageHistory)) {
          toast.warning(
            "Some attachments could not be loaded and were left out of this request"
          );
        }

        await fetchAIResponse(
          {
            messageHistory: apiMessageHistory as any,
            modelId: selectedModel.id,
            // In node mode the node is the only provider the app knows, so
            // always force its URL — its models were fetched just above and its
            // API key was just (re)installed, so the SDK never needs to fall
            // back, and a fallback would spend the user's sats somewhere they
            // never chose. Outside node mode, only force the user's provider
            // when the SDK will read OUR cache. Without the shared managers it
            // re-fetches models first and then throws if the forced provider
            // has since dropped the model, where ranking would simply have
            // picked another one.
            forcedProvider: nodePays
              ? nodePays.url
              : (hasCache && baseUrl) || undefined,
            torMode: isTorContext(),
            mode: nodePays ? "apikeys" : "xcashu",
            discoveryAdapter,
            walletAdapter: nodePays
              ? {
                  ...walletAdapter,
                  // The SDK tops up from the wallet on a 402 before failover is
                  // consulted, so while the node pays, anything reaching for the
                  // user's proofs is a bug.
                  sendToken: async () => {
                    throw new Error(
                      "Node mode: refusing to pay from your wallet."
                    );
                  },
                }
              : walletAdapter,
            storageAdapter,
            abortSignal: abortController.signal,
            ...(hasCache
              ? { modelManager, providerManager }
              : {}),
          },
          {
            onPaymentProcessing: setIsPaymentProcessing,
            onStreamingUpdate: (content) => {
              setIsPaymentProcessing(false);
              if (content) streamed = content;
              if (
                streamingConversationIdRef.current !==
                (originConversationId ?? null)
              )
                return;
              if (originConversationId) {
                // The SDK clears right after handing the message to
                // onMessageAppend; wait for enrich+store to commit it,
                // or the UI blanks for the whole image save.
                if (content === "") {
                  void lastAppend.then(() =>
                    setStreamingContentByConversation((prev) => ({
                      ...prev,
                      [originConversationId]: "",
                    }))
                  );
                  return;
                }
                setStreamingContentByConversation((prev) => ({
                  ...prev,
                  [originConversationId]: content,
                }));
              }
            },
            onThinkingUpdate: (content) => {
              setIsPaymentProcessing(false);
              if (
                streamingConversationIdRef.current !==
                (originConversationId ?? null)
              )
                return;
              if (originConversationId) {
                if (content === "") {
                  void lastAppend.then(() =>
                    setThinkingContentByConversation((prev) => ({
                      ...prev,
                      [originConversationId]: "",
                    }))
                  );
                  return;
                }
                setThinkingContentByConversation((prev) => ({
                  ...prev,
                  [originConversationId]: content,
                }));
              }
            },
            onMessageAppend: (incoming) => {
              if (
                abortController.signal.aborted &&
                incoming.role === "system" &&
                streamed.trim()
              ) {
                const partial = streamed;
                streamed = "";
                queue({ role: "assistant", content: partial } as Message);
              }
              queue(incoming as Message);
            },
            onBalanceUpdate: setBalance,
            onTransactionUpdate: (transaction) => {
              const updated = [...transactionHistory, transaction];
              setTransactionHistory(updated);
            },
            onTokenCreated: setPendingCashuAmountState,
            onLastMessageSatsUpdate: (satsSpent) => {
              void lastAppend
                .then(() =>
                  updateLastMessageSatsSpent(originConversationId, satsSpent)
                )
                .catch(console.error);
            },
            onRequestId: (requestId) => {
              requestIdRef.current = requestId;
            },
          },
          {
            client,
            alertLevel: "min",
            logger: consoleLogger,
            getPendingCashuTokenAmount,
          },
        );
        
        // After the SDK finalizes, look up the exact usage entry by requestId
        // for accurate provider-computed cost (includes msat precision, Tinfoil
        // header fallback, etc.) rather than using balance-delta satsSpent.
        const requestId = requestIdRef.current;
        requestIdRef.current = null;
        if (requestId) {
          void lastAppend
            .then(async () => {
              const recentEntries = await usageTrackingDriver.list({
                after: Date.now() - 60_000, // last 60s
                modelId: selectedModel.id,
              });
              const entry = recentEntries.find((e) => e.id === requestId);
              if (entry) {
                updateLastMessageSatsSpent(
                  originConversationId,
                  entry.satsCost
                );
              }
            })
            .catch(console.error);
        }

        setPendingCashuAmountState(getPendingCashuTokenAmount());
      } finally {
        // The SDK resolves before the append pipeline (image enrich + event
        // store) commits the message to state; tearing down earlier leaves
        // a blank gap while big images save.
        await lastAppend;
        setIsLoading(false);
        setIsPaymentProcessing(false);
        setStreamingContent("");
        setThinkingContent("");
        setStreamingConversationId(null);
        streamingConversationIdRef.current = null;
        abortControllerRef.current = null;

        // Stop keep-alive when inference ends
        onInferenceEnd?.();
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
      transactionHistory,
      setPendingCashuAmountState,
      updateLastMessageSatsSpent,
      getLastNonSystemMessageEventId,
      createAndStoreChatEvent,
      client,
      walletAdapter,
      enrichAssistantImages,
    ]
  );

  /**
   * Abort the in-flight AI request / stream, if any.
   */
  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  /**
   * Refund all API keys AND xcashu tokens back to the user's wallet.
   * Refreshes balances first, then calls refundProviders and refundXcashuTokens
   * on the CashuSpender.
   */
  const refundAllApiKeys = useCallback(async () => {
    const mintUrl = cashuStore.activeMintUrl || DEFAULT_MINT_URL;
    const spender = client.getCashuSpender();
    const [providerResults, xcashuResults] = await Promise.all([
      spender.refundProviders(mintUrl, true),
      spender.refundXcashuTokens(mintUrl).catch((error) => {
        console.warn("Failed to refund xcashu tokens", error);
        return [];
      }),
    ]);

    // Trigger store hydration so balance hooks pick up the changes
    try {
      await hydrateStore;
    } catch {
      // Best-effort refresh
    }

    const totalRefunded =
      providerResults.filter((r) => r.success).length +
      xcashuResults.filter((r) => r.success).length;
    const totalFailed =
      providerResults.filter((r) => !r.success).length +
      xcashuResults.filter((r) => !r.success).length;

    return {
      totalRefunded,
      totalFailed,
      results: [...providerResults, ...xcashuResults],
    };
  }, [client, cashuStore.activeMintUrl]);

  return {
    inputMessage,
    isLoading,
    isPaymentProcessing,
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
    refundAllApiKeys,
    stopGeneration,
  };
};
