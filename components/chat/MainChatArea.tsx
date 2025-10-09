'use client';

import React from 'react';
import { useChat } from '@/context/ChatProvider';
import { useAuth } from '@/context/AuthProvider';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';
import { getTextFromContent } from '@/utils/messageUtils';

/**
 * Central chat interface component
 * Handles chat messages container, chat input container,
 * streaming content display, and message interaction handling
 */
const MainChatArea: React.FC = () => {
  const { isAuthenticated } = useAuth();
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
    uploadedImages,
    setUploadedImages,
    isLoading,
    textareaHeight,
    setTextareaHeight,
    
    // UI State
    isSidebarCollapsed,
    isMobile,
    setIsLoginModalOpen,
    
    // Conversation State
    activeConversationId,
    createNewConversationHandler,
    saveConversationById,
    getActiveConversationId,
    
    // API State
    selectedModel,
    baseUrl,
    mintUrl,
    
    // Actions
    sendMessage,
    saveInlineEdit,
    retryMessage
  } = useChat();

  const handleSendMessage = async () => {
    await sendMessage(
      messages,
      setMessages,
      activeConversationId,
      createNewConversationHandler,
      selectedModel,
      baseUrl,
      mintUrl,
      isAuthenticated,
      setIsLoginModalOpen,
      saveConversationById,
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
      baseUrl,
      mintUrl,
      activeConversationId,
      saveConversationById,
      getActiveConversationId
    );
  };

  const handleRetryMessage = (index: number) => {
    retryMessage(
      index,
      messages,
      setMessages,
      selectedModel,
      baseUrl,
      mintUrl,
      activeConversationId,
      saveConversationById,
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
      />

      {/* Chat Input */}
      <ChatInput
        inputMessage={inputMessage}
        setInputMessage={setInputMessage}
        uploadedImages={uploadedImages}
        setUploadedImages={setUploadedImages}
        sendMessage={handleSendMessage}
        isLoading={isLoading}
        isAuthenticated={isAuthenticated}
        textareaHeight={textareaHeight}
        setTextareaHeight={setTextareaHeight}
        isSidebarCollapsed={isSidebarCollapsed}
        isMobile={isMobile}
        hasMessages={messages.length > 0}
      />
    </>
  );
};

export default MainChatArea;