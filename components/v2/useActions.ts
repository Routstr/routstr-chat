import { useCallback } from "react";
import { useChat } from "@/context/ChatProvider";
import { useUi } from "./ui";
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
  const { setFace } = useUi();
  const { messages, setMessages, activeConversationId, getActiveConversationId, selectedModel } = chat;
  // the logic asks for a sign in when there is no key yet: the composer turns to it
  const askSignIn = useCallback(
    (open: boolean) => {
      if (open) setFace("auth");
    },
    [setFace]
  );

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
        askSignIn,
        getActiveConversationId
      ),
    [chat.sendMessage, messages, setMessages, activeConversationId, selectedModel, forcedBaseUrl, isAuthenticated, askSignIn]
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
    [chat.retryMessage, messages, setMessages, selectedModel, forcedBaseUrl, activeConversationId]
  );

  // the edit box closes once the new version is in
  const saveEdit = useCallback(
    (index: number, text: string, close: () => void) =>
      chat.saveInlineEdit(
        index,
        text,
        messages,
        setMessages,
        (i) => {
          if (i === null) close();
        },
        () => {},
        selectedModel,
        forcedBaseUrl(),
        activeConversationId,
        getActiveConversationId
      ),
    [chat.saveInlineEdit, messages, setMessages, selectedModel, forcedBaseUrl, activeConversationId]
  );

  return { send, retry, saveEdit };
}
