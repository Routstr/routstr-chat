'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useNostr } from '@/context/NostrContext';
import { DEFAULT_BASE_URL, DEFAULT_MINT_URL } from '@/lib/utils';
import { fetchBalances, getBalanceFromStoredProofs, getOrCreateApiToken, invalidateApiToken, refundRemainingBalance } from '@/utils/cashuUtils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  Loader2,
  Menu,
} from 'lucide-react';
import { Model } from '@/data/models';
import SettingsModal from '@/components/SettingsModal';
import LoginModal from '@/components/LoginModal';
import TutorialOverlay from '@/components/TutorialOverlay';
import Sidebar from '@/components/chat/Sidebar';
import ChatMessages from '@/components/chat/ChatMessages';
import ChatInput from '@/components/chat/ChatInput';
import ModelSelector from '@/components/chat/ModelSelector';
import { Conversation, Message, MessageContent, TransactionHistory } from '@/types/chat';
import { toast } from 'sonner';

// Default token amount for models without max_cost defined
const DEFAULT_TOKEN_AMOUNT = 50;

function ChatPageContent() {
  const { isAuthenticated, logout } = useNostr();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [authChecked, setAuthChecked] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [textareaHeight, setTextareaHeight] = useState(48);

  // Image upload state
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);

  // Tutorial state
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  // UI state
  const [isModelDrawerOpen, setIsModelDrawerOpen] = useState(false);
  const modelDrawerRef = useRef<HTMLDivElement>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [transactionHistory, setTransactionHistory] = useState<TransactionHistory[]>([]);
  const [hotTokenBalance, setHotTokenBalance] = useState<number>(0);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Responsive design
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Helper functions for multimodal content
  const getTextFromContent = useCallback((content: string | MessageContent[]): string => {
    if (typeof content === 'string') return content;
    const textContent = content.find(item => item.type === 'text');
    return textContent?.text || '';
  }, []);

  const convertMessageForAPI = (message: Message): { role: string; content: string | MessageContent[] } => {
    return {
      role: message.role,
      content: message.content
    };
  };

  const createTextMessage = (role: string, text: string): Message => {
    return {
      role,
      content: text
    };
  };

  const createMultimodalMessage = (role: string, text: string, images: string[]): Message => {
    const content: MessageContent[] = [
      { type: 'text', text }
    ];

    images.forEach(imageUrl => {
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      });
    });

    return {
      role,
      content
    };
  };


  // Close model drawer when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isModelDrawerOpen && modelDrawerRef.current &&
        !modelDrawerRef.current.contains(event.target as Node)) {
        setIsModelDrawerOpen(false);
      }
    };

    if (isModelDrawerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDrawerOpen]);

  // Define saveCurrentConversation before it's used in useEffect
  const saveCurrentConversation = useCallback(() => {
    if (!activeConversationId) return;

    setConversations(prevConversations => {
      let title = prevConversations.find(c => c.id === activeConversationId)?.title;
      if (!title || title.startsWith('Conversation ')) {
        const firstUserMessage = messages.find(m => m.role === 'user');
        if (firstUserMessage) {
          const messageText = getTextFromContent(firstUserMessage.content);
          title = messageText.length > 30
            ? messageText.substring(0, 30) + '...'
            : messageText;
        }
      }

      const updatedConversations = prevConversations.map(conversation => {
        if (conversation.id === activeConversationId) {
          // Strip image data from messages before saving
          const messagesToSave = messages.map(msg => {
            if (Array.isArray(msg.content)) {
              const textContent = msg.content.filter(item => item.type === 'text');
              if (textContent.length === 0 && msg.content.some(item => item.type === 'image_url')) {
                // If only images were present, save a placeholder
                return { ...msg, content: '[Image(s) not saved to local storage]' };
              }
              return { ...msg, content: textContent.length > 0 ? textContent : '[Content removed]' };
            }
            return msg;
          });

          return {
            ...conversation,
            title: title || conversation.title,
            messages: messagesToSave
          };
        }
        return conversation;
      });
      localStorage.setItem('saved_conversations', JSON.stringify(updatedConversations));
      return updatedConversations;
    });
  }, [activeConversationId, messages, getTextFromContent]);

  // Fetch available models from API and handle URL model selection
  const fetchModels = useCallback(async () => {
    try {
      setIsLoadingModels(true);
      if (!baseUrl) return;
      const response = await fetch(`${baseUrl}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      if(!response.ok) {
        console.log(response);
      }
      const data = await response.json();

      if (data && data.models && Array.isArray(data.models)) {
        setModels(data.models);

        // Get model ID from URL if present
        const urlModelId = searchParams.get('model');

        if (urlModelId) {
          // Find the model from the URL parameter
          const urlModel = data.models.find((m: Model) => m.id === urlModelId);
          if (urlModel) {
            setSelectedModel(urlModel);
            localStorage.setItem('lastUsedModel', urlModelId);
            return;
          }
        }

        // If no URL model or model not found, use last used or first available
        const lastUsedModelId = localStorage.getItem('lastUsedModel');
        if (lastUsedModelId) {
          const lastModel = data.models.find((m: Model) => m.id === lastUsedModelId);
          if (lastModel) {
            setSelectedModel(lastModel);
          } else if (data.models.length > 0) {
            setSelectedModel(data.models[0]);
          }
        } else if (data.models.length > 0) {
          setSelectedModel(data.models[0]);
        }
      }
    } catch (error) {
      console.error('Error while fetching models', error);
      setModels([]);
      setSelectedModel(null);
      toast.error('The provider might not be available');
    } finally {
      setIsLoadingModels(false);
    }
  }, [searchParams, baseUrl]);

  // Get user balance and saved conversations from localStorage on page load
  useEffect(() => { // This useEffect should be triggered once on mount, and then again if isAuthenticated changes
    setAuthChecked(true); // Always set authChecked to true on initial render

    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
      return;
    }

    setIsLoginModalOpen(false); // Close login modal if authenticated

    const currentMintUrl = localStorage.getItem('mint_url') ?? DEFAULT_MINT_URL;
    setMintUrl(currentMintUrl);
    const currentBaseUrl = localStorage.getItem('base_url') ?? DEFAULT_BASE_URL;
    setBaseUrl(currentBaseUrl.endsWith('/') ? currentBaseUrl : `${currentBaseUrl}/`);

    const loadData = async () => {
      // Use selected model's max_cost if available, otherwise use default
      const tokenAmount = selectedModel?.sats_pricing?.max_cost ?? DEFAULT_TOKEN_AMOUNT;
      const { apiBalance, proofsBalance } = await fetchBalances(currentMintUrl, currentBaseUrl);

      setBalance((apiBalance / 1000) + (proofsBalance / 1000));
      setHotTokenBalance(apiBalance);

      const savedTransactionHistory = localStorage.getItem('transaction_history');
      if (savedTransactionHistory) {
        try {
          const parsedTransactionHistory = JSON.parse(savedTransactionHistory);
          if (Array.isArray(parsedTransactionHistory)) {
            setTransactionHistory(parsedTransactionHistory);
          } else {
            setTransactionHistory([]);
          }
        } catch {
          setTransactionHistory([]);
        }
      } else {
        setTransactionHistory([]);
      }

      const savedConversationsData = localStorage.getItem('saved_conversations');
      if (savedConversationsData) {
        try {
          const parsedConversations = JSON.parse(savedConversationsData);
          if (Array.isArray(parsedConversations)) {
            setConversations(parsedConversations);
          } else {
            setConversations([]);
          }
        } catch {
          setConversations([]);
        }
      } else {
        setConversations([]);
      }
    };

    loadData();

  }, [isAuthenticated, selectedModel]); // Added selectedModel to dependency array

  // This useEffect will run when baseUrl changes to fetch models
  useEffect(() => {
    if (isAuthenticated) {
      fetchModels();
    }
  }, [baseUrl, fetchModels, isAuthenticated]);

  // Check for first visit and show tutorial
  useEffect(() => { // No longer depends on authChecked
    if (isAuthenticated && !isMobile) {
      const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
      if (!hasSeenTutorial) {
        setTimeout(() => {
          setIsTutorialOpen(true);
        }, 1000);
      }
    }
  }, [isAuthenticated, isMobile]);

  // iOS Safari viewport height stabilization
  useEffect(() => {
    if (typeof window !== 'undefined' && isMobile) {
      const timerId = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 500);

      return () => clearTimeout(timerId);
    }
  }, [isMobile]);

  // Scroll to bottom of chat when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // When streaming content updates, scroll to bottom
  useEffect(() => {
    if (streamingContent && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streamingContent]);

  // Save current conversation to localStorage whenever it changes
  useEffect(() => {
    if (activeConversationId && messages.length > 0) {
      saveCurrentConversation();
    }
  }, [messages, activeConversationId, saveCurrentConversation]);

  // Set input message to the content of the message being edited
  useEffect(() => {
    if (editingMessageIndex !== null && messages[editingMessageIndex]) {
      const messageText = getTextFromContent(messages[editingMessageIndex].content);
      setEditingContent(messageText);
    }
  }, [editingMessageIndex, messages]);

  const startEditingMessage = (index: number) => {
    setEditingMessageIndex(index);
    const messageText = getTextFromContent(messages[index].content);
    setEditingContent(messageText);
  };

  const cancelEditing = () => {
    setEditingMessageIndex(null);
    setEditingContent('');
  };

  const saveInlineEdit = async () => {
    if (editingMessageIndex !== null && editingContent.trim()) {
      const updatedMessages = [...messages];
      updatedMessages[editingMessageIndex] = {
        ...updatedMessages[editingMessageIndex],
        content: editingContent
      };

      const truncatedMessages = updatedMessages.slice(0, editingMessageIndex + 1);

      setMessages(truncatedMessages);
      setEditingMessageIndex(null);
      setEditingContent('');

      await fetchAIResponse(truncatedMessages);
    }
  };

  const fetchAIResponse = async (messageHistory: Message[]) => {
    setIsLoading(true);
    setStreamingContent('');

    const initialBalance = getBalanceFromStoredProofs();

    const makeRequest = async (retryOnInsufficientBalance: boolean = true): Promise<Response> => {
      // Use selected model's max_cost if available, otherwise use default
      const tokenAmount = selectedModel?.sats_pricing?.max_cost ?? DEFAULT_TOKEN_AMOUNT;

      const token = await getOrCreateApiToken(mintUrl, tokenAmount);

      if (!token) {
        throw new Error(`Insufficient balance. Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`);
      }

      if (typeof token === 'object' && 'hasTokens' in token && !token.hasTokens) {
        throw new Error(`Insufficient balance. Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`);
      }

      // Convert messages to API format
      const apiMessages = messageHistory.map(convertMessageForAPI);

      const response = await fetch(`${baseUrl}v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          model: selectedModel?.id,
          messages: apiMessages,
          stream: true
        })
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          invalidateApiToken();
          throw new Error('Token expired. Please try again.');
        }

        // Handle insufficient balance (402)
        if (response.status === 402 && retryOnInsufficientBalance) {
          // Invalidate current token since it's out of balance
          invalidateApiToken();

          // Try to create a new token and retry once
          const newToken = await getOrCreateApiToken(mintUrl, tokenAmount);

          if (!newToken || (typeof newToken === 'object' && 'hasTokens' in newToken && !newToken.hasTokens)) {
            throw new Error(`Insufficient balance. Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`);
          }

          // Recursive call with retry flag set to false to prevent infinite loops
          return makeRequest(false);
        }
 
        if (response.status === 413) {
          await refundRemainingBalance(mintUrl, baseUrl)
          return makeRequest(false);
          // refund exsisting balance
          // fetch min balance needed for reques
          // check if balance is enough
          // if not find model with max_cost less than balance
          // show modal with options to add more funds or change model
          // if balance is enough, create new token with that balance threshold
          // retry request
          // if still not enough, throw error
        }

        throw new Error(`API error: ${response.status}`);
      }

      return response;
    };

    try {
      const response = await makeRequest();
 
      if (!response.body) {
        throw new Error('Response body is not available');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedContent = '';
 
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        try {
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.trim()) continue;

            if (line.startsWith('data: ')) {
              const jsonData = line.slice(6);

              if (jsonData === '[DONE]') continue;

              try {
                const parsedData = JSON.parse(jsonData);

                if (parsedData.choices &&
                  parsedData.choices[0] &&
                  parsedData.choices[0].delta &&
                  parsedData.choices[0].delta.content) {

                  const newContent = parsedData.choices[0].delta.content;

                  accumulatedContent += newContent;

                  setStreamingContent(accumulatedContent);
                }
              } catch {
                // Swallow parse errors for streaming chunks
              }
            }
          }
        } catch {
          // Swallow chunk processing errors
        }
      }
 
      if (accumulatedContent) {
        setMessages(prev => [...prev, createTextMessage('assistant', accumulatedContent)]);
      }

      setStreamingContent('');
 
      const { apiBalance, proofsBalance } = await fetchBalances(mintUrl, baseUrl);
      setBalance(Math.floor(apiBalance / 1000) + Math.floor(proofsBalance / 1000)); // balances returned in mSats
      
      await refundRemainingBalance(mintUrl, baseUrl);

      const satsSpent = initialBalance - getBalanceFromStoredProofs();
      const newTransaction: TransactionHistory = {
        type: 'spent',
        amount: satsSpent,
        timestamp: Date.now(),
        status: 'success',
        model: selectedModel?.id,
        message: 'Tokens spent',
        balance: (apiBalance + proofsBalance) / 1000
      }
      localStorage.setItem('transaction_history', JSON.stringify([...transactionHistory, newTransaction]))
      setTransactionHistory(prev => [...prev, newTransaction]);
      setHotTokenBalance(apiBalance);
    } catch (error) {
      // Only add error to chat, don't use unused error state
      const errorMessage = error instanceof Error ? error.message : 'Failed to process your request';

      setMessages(prev => [...prev, createTextMessage('system', errorMessage)]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
      return;
    }

    if (!inputMessage.trim() && uploadedImages.length === 0) return;

    if (!activeConversationId) {
      createNewConversation();
    }

    // Create user message with text and images
    const userMessage = uploadedImages.length > 0
      ? createMultimodalMessage('user', inputMessage, uploadedImages)
      : createTextMessage('user', inputMessage);

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    setInputMessage('');
    setUploadedImages([]);

    await fetchAIResponse(updatedMessages);
  };

  const createNewConversation = () => {
    const newId = Date.now().toString();
    const newConversation = {
      id: newId,
      title: `Conversation ${conversations.length + 1}`,
      messages: []
    };

    setConversations(prev => [...prev, newConversation]);
    setActiveConversationId(newId);
    setMessages([]);

    localStorage.setItem('saved_conversations', JSON.stringify([...conversations, newConversation]));
  };

  const loadConversation = (conversationId: string) => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (conversation) {
      setActiveConversationId(conversationId);
      setMessages(conversation.messages);
    }
  };

  const deleteConversation = (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const updatedConversations = conversations.filter(c => c.id !== conversationId);
    setConversations(updatedConversations);

    if (conversationId === activeConversationId) {
      setActiveConversationId(null);
      setMessages([]);
    }

    localStorage.setItem('saved_conversations', JSON.stringify(updatedConversations));
  };

  const handleModelChange = (modelId: string) => {
    const model = models.find((m: Model) => m.id === modelId);
    if (model) {
      setSelectedModel(model);
      localStorage.setItem('lastUsedModel', modelId);
    }
  };

  const filteredModels = models;

  const clearConversations = () => {
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    localStorage.removeItem('saved_conversations');
  };

  const handleTutorialComplete = useCallback(() => {
    localStorage.setItem('hasSeenTutorial', 'true');
  }, []);

  const handleTutorialClose = useCallback(() => {
    setIsTutorialOpen(false);
  }, []);

  const retryMessage = useCallback((index: number) => {
    const newMessages = messages.slice(0, index);
    setMessages(newMessages);
    fetchAIResponse(newMessages);
  }, [messages, fetchAIResponse]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-dvh w-full bg-black">
        <Loader2 className="h-8 w-8 text-white/50 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full bg-black text-white overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isMobile && (
        <div
          className={`fixed inset-0 bg-black/70 z-40 transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar */}
      <Sidebar
        isAuthenticated={isAuthenticated}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        isSidebarCollapsed={isSidebarCollapsed}
        setIsSidebarCollapsed={setIsSidebarCollapsed}
        isMobile={isMobile}
        conversations={conversations}
        activeConversationId={activeConversationId}
        createNewConversation={createNewConversation}
        loadConversation={loadConversation}
        deleteConversation={deleteConversation}
        setIsSettingsOpen={setIsSettingsOpen}
        balance={balance}
      />

      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col h-full overflow-hidden relative transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'ml-0' : ''}`}>
        {/* Fixed Model Selection Header */}
        <div className={`fixed top-0 bg-black/95 backdrop-blur-sm z-40 ${isMobile ? 'left-0 right-0' : isSidebarCollapsed ? 'left-0 right-0' : 'left-72 right-0'}`}>
          <div className="flex items-center justify-center h-[60px] px-4 relative">
            {/* Mobile Menu Button */}
            {isMobile && !isAuthenticated && (
              <button
                onClick={() => setIsLoginModalOpen(true)}
                className="absolute left-4 bg-black rounded-full p-1.5 shadow-md border border-white/10 hover:bg-white/5 cursor-pointer"
              >
                <Menu className="h-4 w-4 text-white/70" />
              </button>
            )}
            {isMobile && isAuthenticated && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="absolute left-4 bg-black rounded-full p-1.5 shadow-md border border-white/10 hover:bg-white/5 cursor-pointer"
              >
                <Menu className="h-4 w-4 text-white/70" />
              </button>
            )}

            <ModelSelector
              selectedModel={selectedModel}
              isModelDrawerOpen={isModelDrawerOpen}
              setIsModelDrawerOpen={setIsModelDrawerOpen}
              isAuthenticated={isAuthenticated}
              setIsLoginModalOpen={setIsLoginModalOpen}
              isLoadingModels={isLoadingModels}
              filteredModels={filteredModels}
              handleModelChange={handleModelChange}
              balance={balance}
            />

            {/* Balance/Sign in button in top right */}
            <div className="absolute right-4 text-xs text-white/50">
              {isAuthenticated ? `${balance} sats` : (
                <button
                  onClick={() => setIsLoginModalOpen(true)}
                  className="px-3 py-1.5 rounded-full bg-white text-black hover:bg-gray-200 transition-colors text-xs"
                >
                  Sign in
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Chat Messages */}
        <ChatMessages
          messages={messages}
          streamingContent={streamingContent}
          editingMessageIndex={editingMessageIndex}
          editingContent={editingContent}
          setEditingContent={setEditingContent}
          startEditingMessage={startEditingMessage}
          cancelEditing={cancelEditing}
          saveInlineEdit={saveInlineEdit}
          retryMessage={retryMessage}
          getTextFromContent={getTextFromContent}
          messagesEndRef={messagesEndRef}
        />

        {/* Chat Input */}
        <ChatInput
          inputMessage={inputMessage}
          setInputMessage={setInputMessage}
          uploadedImages={uploadedImages}
          setUploadedImages={setUploadedImages}
          sendMessage={sendMessage}
          isLoading={isLoading}
          isAuthenticated={isAuthenticated}
          textareaHeight={textareaHeight}
          setTextareaHeight={setTextareaHeight}
          isSidebarCollapsed={isSidebarCollapsed}
          isMobile={isMobile}
        />
      </div>

      {/* Modals */}
      {isSettingsOpen && isAuthenticated && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          mintUrl={mintUrl}
          setMintUrl={setMintUrl}
          baseUrl={baseUrl}
          setBaseUrl={setBaseUrl}
          selectedModel={selectedModel}
          handleModelChange={handleModelChange}
          models={models}
          balance={balance}
          setBalance={setBalance}
          clearConversations={clearConversations}
          logout={logout}
          router={router}
          transactionHistory={transactionHistory}
          setTransactionHistory={setTransactionHistory}
        />
      )}

      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />

      <TutorialOverlay
        isOpen={isTutorialOpen}
        onComplete={handleTutorialComplete}
        onClose={handleTutorialClose}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-dvh w-full bg-black">
        <Loader2 className="h-8 w-8 text-white/50 animate-spin" />
      </div>
    }>
      <ChatPageContent />
    </Suspense>
  );
}
