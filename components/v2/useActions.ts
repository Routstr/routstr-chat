import { useCallback } from "react";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import { normalizeBaseUrl, parseModelKey } from "@/utils/modelUtils";
import { loadLastUsedModel } from "@/utils/storageUtils";
import { providerManager } from "@/sdk/sharedStore";
import { isTorContext } from "@/utils/torUtils";

/* Send, retry and edit, called exactly as the old screen called them. The
   provider you pinned is honoured only while it still routes this model;
   otherwise "" lets the SDK rank providers itself. */
export function useActions() {
  const chat = useChat();
  const { isAuthenticated } = useAuth();
  const {
    messages,
    setMessages,
    activeConversationId,
    getActiveConversationId,
    selectedModel,
    setIsLoginModalOpen,
    editingMessageIndex,
    editingContent,
    setEditingMessageIndex,
    setEditingContent,
  } = chat;

  const forcedBaseUrl = useCallback(() => {
    if (!selectedModel) return "";
    const key = loadLastUsedModel();
    if (!key) return "";
    const parsed = parseModelKey(key);
    const base = normalizeBaseUrl(parsed.base);
    if (!base || parsed.id !== selectedModel.id) return "";
    const routable = providerManager
      .getProviderPriceRankingForModel(selectedModel.id, { torMode: isTorContext() })
      .some((entry) => normalizeBaseUrl(entry.baseUrl) === base);
    return routable ? base : "";
  }, [selectedModel]);

  const send = useCallback(
    () =>
      chat.sendMessage(
        messages,
        setMessages,
        activeConversationId,
        selectedModel,
        forcedBaseUrl(),
        isAuthenticated,
        setIsLoginModalOpen,
        getActiveConversationId
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.sendMessage, messages, setMessages, activeConversationId, selectedModel, forcedBaseUrl, isAuthenticated]
  );

  const retry = useCallback(
    (index: number) =>
      chat.retryMessage(
        index,
        messages,
        setMessages,
        selectedModel,
        forcedBaseUrl(),
        activeConversationId,
        getActiveConversationId
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.retryMessage, messages, setMessages, selectedModel, forcedBaseUrl, activeConversationId]
  );

  const saveEdit = useCallback(
    () =>
      chat.saveInlineEdit(
        editingMessageIndex,
        editingContent,
        messages,
        setMessages,
        (i) => editingMessageIndex !== null && setEditingMessageIndex(i),
        setEditingContent,
        selectedModel,
        forcedBaseUrl(),
        activeConversationId,
        getActiveConversationId
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.saveInlineEdit, editingMessageIndex, editingContent, messages, setMessages, selectedModel, forcedBaseUrl, activeConversationId]
  );

  return { send, retry, saveEdit };
}
