"use client";

import React, { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import ChatMessages from "./ChatMessages";
import ChatInput from "./ChatInput";
import { getTextFromContent } from "@/utils/messageUtils";
import { normalizeBaseUrl, parseModelKey } from "@/utils/modelUtils";
import { loadLastUsedModel } from "@/utils/storageUtils";
import { providerManager } from "@/sdk/sharedStore";
import { isTorContext } from "@/utils/torUtils";

/**
 * Central chat interface component
 * Handles chat messages container, chat input container,
 * streaming content display, and message interaction handling
 */
const MainChatArea: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const searchParams = useSearchParams();
  const chatIdFromUrl = useMemo(() => searchParams.get("chatId"), [searchParams]);
  
  const {
    // Message State
    messages,
    setMessages,
    streamingContent,
    thinkingContent,
    streamingConversationId,
    getStreamingContentFor,
    getThinkingContentFor,
    editingMessageIndex,
    editingContent,
    setEditingContent,
    setEditingMessageIndex,
    startEditingMessage,
    cancelEditing,
    messagesEndRef,

    // Chat Actions
    inputMessage,
    setInputMessage,
    uploadedAttachments,
    setUploadedAttachments,
    isLoading,
    isPaymentProcessing,
    textareaHeight,
    setTextareaHeight,

    // UI State
    isSidebarCollapsed,
    isMobile,
    setIsLoginModalOpen,

    // Conversation State
    activeConversationId,
    getActiveConversationId,
    conversationsLoaded,
    isSyncing,

    // API State
    selectedModel,
    isLoadingModels,
    isWalletLoading,

    // Actions
    sendMessage,
    saveInlineEdit,
    retryMessage,
    stopGeneration,
  } = useChat();

  const isLoadingChatFromUrl = useMemo(() => {
    if (!chatIdFromUrl) return false;
    if (chatIdFromUrl === activeConversationId && messages.length > 0) return false;
    return !conversationsLoaded || isSyncing;
  }, [chatIdFromUrl, activeConversationId, messages.length, conversationsLoaded, isSyncing]);

  // The explicitly chosen provider from the persisted selection key (NOT
  // modelProviderMap, which is auto-filled with the cheapest), else "" to keep
  // SDK ranking. Resolved at send time: forcedProvider skips the SDK's own
  // disabled/cooldown checks and throws if the provider dropped the model.
  const resolveForcedBaseUrl = () => {
    if (!selectedModel) return "";
    const key = loadLastUsedModel();
    const base = key ? normalizeBaseUrl(parseModelKey(key).base) : null;
    if (!base || parseModelKey(key!).id !== selectedModel.id) return "";

    const routable = providerManager
      .getProviderPriceRankingForModel(selectedModel.id, {
        torMode: isTorContext(),
      })
      .some((entry) => normalizeBaseUrl(entry.baseUrl) === base);
    return routable ? base : "";
  };

  const handleSendMessage = async () => {
    await sendMessage(
      messages,
      setMessages,
      activeConversationId,
      selectedModel,
      resolveForcedBaseUrl(),
      isAuthenticated,
      setIsLoginModalOpen,
      getActiveConversationId
    );
  };

  const handleSaveInlineEdit = async () => {
    await saveInlineEdit(
      editingMessageIndex,
      editingContent,
      messages,
      setMessages,
      (index) => editingMessageIndex !== null && setEditingMessageIndex(index),
      setEditingContent,
      selectedModel,
      resolveForcedBaseUrl(),
      activeConversationId,
      getActiveConversationId
    );
  };

  const handleRetryMessage = (index: number) => {
    retryMessage(
      index,
      messages,
      setMessages,
      selectedModel,
      resolveForcedBaseUrl(),
      activeConversationId,
      getActiveConversationId
    );
  };

  return (
    <>
      {/* Chat Messages */}
      <ChatMessages
        messages={messages}
        streamingContent={getStreamingContentFor(activeConversationId)}
        thinkingContent={getThinkingContentFor(activeConversationId)}
        editingMessageIndex={editingMessageIndex}
        editingContent={editingContent}
        setEditingContent={setEditingContent}
        startEditingMessage={startEditingMessage}
        cancelEditing={cancelEditing}
        saveInlineEdit={handleSaveInlineEdit}
        retryMessage={handleRetryMessage}
        getTextFromContent={getTextFromContent}
        messagesEndRef={messagesEndRef}
        isMobile={isMobile}
        textareaHeight={textareaHeight}
        isLoading={isLoading}
        isPaymentProcessing={isPaymentProcessing}
        isLoadingChatFromUrl={isLoadingChatFromUrl}
        modelOutputsImages={(
          selectedModel?.architecture?.output_modalities ?? []
        ).includes("image")}
      />

      {/* Chat Input */}
      <ChatInput
        inputMessage={inputMessage}
        setInputMessage={setInputMessage}
        uploadedAttachments={uploadedAttachments}
        setUploadedAttachments={setUploadedAttachments}
        sendMessage={handleSendMessage}
        isLoading={isLoading}
        isAuthenticated={isAuthenticated}
        setTextareaHeight={setTextareaHeight}
        isSidebarCollapsed={isSidebarCollapsed}
        isMobile={isMobile}
        hasMessages={messages.length > 0}
        isLoadingModels={isLoadingModels}
        isWalletLoading={isWalletLoading}
        isLoadingChatFromUrl={isLoadingChatFromUrl}
        stopGeneration={stopGeneration}
      />
    </>
  );
};

export default MainChatArea;
