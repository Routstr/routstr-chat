import { Message, MessageContent, TransactionHistory } from '@/types/chat';
import { convertMessageForAPI, createTextMessage, extractThinkingFromStream } from './messageUtils';
import { fetchBalances, getBalanceFromStoredProofs, refundRemainingBalance, unifiedRefund } from '@/utils/cashuUtils';
import { getLocalCashuToken, removeLocalCashuToken } from './storageUtils';
import { getDecodedToken } from '@cashu/cashu-ts';
import { isThinkingCapableModel } from './thinkingParser';

export interface FetchAIResponseParams {
  messageHistory: Message[];
  selectedModel: any;
  baseUrl: string;
  mintUrl: string;
  usingNip60: boolean;
  balance: number;
  unit: string;
  spendCashu: (mintUrl: string, amount: number, baseUrl: string, p2pkPubkey?: string) => Promise<string | null | { hasTokens: false }>;
  storeCashu: (token: string) => Promise<any[]>;
  activeMintUrl?: string | null;
  onStreamingUpdate: (content: string) => void;
  onThinkingUpdate: (content: string) => void;
  onMessagesUpdate: (messages: Message[]) => void;
  onMessageAppend: (message: Message) => void;
  onBalanceUpdate: (balance: number) => void;
  onTransactionUpdate: (transaction: TransactionHistory) => void;
  transactionHistory: TransactionHistory[];
  onTokenCreated: (amount: number) => void;
}

/**
 * Makes an API request with token authentication
 */
async function routstrRequest(params: {
  apiMessages: any[];
  selectedModel: any;
  baseUrl: string;
  mintUrl: string;
  usingNip60: boolean;
  tokenAmount: number;
  spendCashu: (mintUrl: string, amount: number, baseUrl: string, p2pkPubkey?: string) => Promise<string | null | { hasTokens: false }>;
  storeCashu: (token: string) => Promise<any[]>;
  activeMintUrl?: string | null;
  onMessageAppend: (message: Message) => void;
  token: string;
  retryOnInsufficientBalance?: boolean;
}): Promise<Response> {
  const {
    apiMessages,
    selectedModel,
    baseUrl,
    mintUrl,
    usingNip60,
    tokenAmount,
    spendCashu,
    storeCashu,
    activeMintUrl,
    onMessageAppend,
    token,
    retryOnInsufficientBalance = true
  } = params;

  if (!token) {
    throw new Error(`Insufficient balance. Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`);
  }

  // token is expected to be a string here

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // Optional dev-only mock controls via localStorage
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    try {
      const scenario = window.localStorage.getItem('msw:scenario');
      const latency = window.localStorage.getItem('msw:latency');
      if (scenario) headers['X-Mock-Scenario'] = scenario;
      if (latency) headers['X-Mock-Latency'] = latency;
    } catch {}
  }

  const response = await fetch(`${baseUrl}v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: selectedModel?.id,
      messages: apiMessages,
      stream: true
    })
  });

  if (!response.ok) {
    await handleApiError(response, {
      mintUrl,
      baseUrl,
      usingNip60,
      storeCashu,
      tokenAmount,
      selectedModel,
      spendCashu,
      activeMintUrl,
      retryOnInsufficientBalance,
      onMessageAppend
    });
  }

  return response;
}

/**
 * Makes an API request with token authentication
 */
async function routstrRequest(params: {
  apiMessages: any[];
  selectedModel: any;
  baseUrl: string;
  mintUrl: string;
  usingNip60: boolean;
  tokenAmount: number;
  spendCashu: (mintUrl: string, amount: number, baseUrl: string, p2pkPubkey?: string) => Promise<string | null | { hasTokens: false }>;
  storeCashu: (token: string) => Promise<any[]>;
  activeMintUrl?: string | null;
  onMessageAppend: (message: Message) => void;
  token: string;
  retryOnInsufficientBalance?: boolean;
}): Promise<Response> {
  const {
    apiMessages,
    selectedModel,
    baseUrl,
    mintUrl,
    usingNip60,
    tokenAmount,
    spendCashu,
    storeCashu,
    activeMintUrl,
    onMessageAppend,
    token,
    retryOnInsufficientBalance = true
  } = params;

  if (!token) {
    throw new Error(`Insufficient balance. Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`);
  }

  // token is expected to be a string here

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // Optional dev-only mock controls via localStorage
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    try {
      const scenario = window.localStorage.getItem('msw:scenario');
      const latency = window.localStorage.getItem('msw:latency');
      if (scenario) headers['X-Mock-Scenario'] = scenario;
      if (latency) headers['X-Mock-Latency'] = latency;
    } catch {}
  }

  const response = await fetch(`${baseUrl}v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: selectedModel?.id,
      messages: apiMessages,
      stream: true
    })
  });

  if (!response.ok) {
    await handleApiError(response, {
      mintUrl,
      baseUrl,
      usingNip60,
      storeCashu,
      tokenAmount,
      selectedModel,
      spendCashu,
      activeMintUrl,
      retryOnInsufficientBalance,
      onMessageAppend
    });
  }

  return response;
}

/**
 * Fetches AI response from the API with streaming support
 * @param params Configuration object with all required parameters
 * @returns Promise that resolves when the response is complete
 */

/**
 * Gets the token amount to use for a model, with fallback to default
 * @param selectedModel The currently selected model
 * @returns The token amount in sats
 */
const getTokenAmountForModel = (selectedModel: any, apiMessages: any[]): number => {
  const approximateTokens = Math.ceil(JSON.stringify(apiMessages, null, 2).length / 2.84);
  if (!selectedModel?.sats_pricing?.max_completion_cost) {
    return selectedModel?.sats_pricing?.max_cost ?? 50;
  }
  const promptCosts = selectedModel?.sats_pricing?.prompt * approximateTokens;
  const totalEstimatedCosts = promptCosts + selectedModel?.sats_pricing?.max_completion_cost;
  return (totalEstimatedCosts * 1.05); // Added a 5% margin
};

export const fetchAIResponse = async (params: FetchAIResponseParams): Promise<void> => {
  const {
    messageHistory,
    selectedModel,
    baseUrl,
    mintUrl,
    usingNip60,
    balance,
    unit,
    spendCashu,
    storeCashu,
    activeMintUrl,
    onStreamingUpdate,
    onThinkingUpdate,
    onMessagesUpdate,
    onMessageAppend,
    onBalanceUpdate,
    onTransactionUpdate,
    transactionHistory,
    onTokenCreated
  } = params;

  const initialBalance = usingNip60 ? balance : getBalanceFromStoredProofs();

  // Convert messages to API format
  // Filter out system messages (error messages) before sending to API
  const apiMessages = messageHistory
    .filter(message => message.role !== 'system')
    .map(convertMessageForAPI);

  let tokenAmount = getTokenAmountForModel(selectedModel, apiMessages);

  try {
    const token = await spendCashu(
      mintUrl,
      usingNip60 && unit == 'msat'? tokenAmount*1000 : tokenAmount,
      baseUrl
    );

    if (token && typeof token === 'string') {
      const decodedToken = getDecodedToken(token)
      if (decodedToken.unit == 'msat') {
        onTokenCreated(tokenAmount)
      }
      else {
        let roundedTokenAmount = tokenAmount;
        if (roundedTokenAmount % 1 !== 0) {
          roundedTokenAmount = Math.ceil(roundedTokenAmount);
        }
        onTokenCreated(roundedTokenAmount);
      }
    }

    const response = await routstrRequest({
      apiMessages,
      selectedModel,
      baseUrl,
      mintUrl,
      usingNip60,
      tokenAmount,
      spendCashu,
      storeCashu,
      activeMintUrl,
      onMessageAppend,
      token: token as string,
      retryOnInsufficientBalance: true
    });
    // const response = new Response();

    if (!response.body) {
      throw new Error('Response body is not available');
    }

    const streamingResult = await processStreamingResponse(response, onStreamingUpdate, onThinkingUpdate, selectedModel?.id);

    if (streamingResult.content || streamingResult.images) {
      const assistantMessage = createAssistantMessage(streamingResult);
      onMessagesUpdate([...messageHistory, assistantMessage]);
    }

    let estimatedCosts = 0; // Initialize to 0
    // Log usage statistics if available
    if (streamingResult.usage) {
      if ( streamingResult.usage.completion_tokens !== undefined && streamingResult.usage.prompt_tokens !== undefined) {
        estimatedCosts = selectedModel?.sats_pricing.completion * streamingResult.usage.completion_tokens + selectedModel?.sats_pricing.prompt * streamingResult.usage.prompt_tokens
        console.log("Estimated costs: ", estimatedCosts);
      }
    }

    onStreamingUpdate('');
    onThinkingUpdate('');

    // Handle refund and balance update
    await handlePostResponseRefund({
      mintUrl,
      baseUrl,
      usingNip60,
      storeCashu,
      tokenAmount,
      initialBalance,
      selectedModel,
      onBalanceUpdate,
      onTransactionUpdate,
      transactionHistory,
      messageHistory,
      onMessagesUpdate,
      onMessageAppend,
      estimatedCosts, // Pass estimatedCosts here
      unit // Pass unit here
    });
    console.log("rdlogs:rdlogs: respon 42069", response)

  } catch (error) {
    console.log('API Error: ', error);
    if (error instanceof Error) {
      logApiError(error.message, onMessageAppend);
    } else {
      logApiError('An unknown error occurred', onMessageAppend);
    }
  }
};

/**
 * Handles API errors and retry logic
 */
async function handleApiError(
  response: Response,
  params: {
    mintUrl: string;
    baseUrl: string;
    usingNip60: boolean;
    storeCashu: (token: string) => Promise<any[]>;
    tokenAmount: number;
    selectedModel: any;
    spendCashu: (mintUrl: string, amount: number, baseUrl: string, p2pkPubkey?: string) => Promise<string | null | { hasTokens: false }>;
    activeMintUrl?: string | null;
    retryOnInsufficientBalance: boolean;
    onMessageAppend: (message: Message) => void;
  }
): Promise<void> {
  const {
    mintUrl,
    baseUrl,
    usingNip60,
    storeCashu,
    tokenAmount,
    selectedModel,
    spendCashu,
    activeMintUrl,
    retryOnInsufficientBalance,
    onMessageAppend
  } = params;

  if (response.status === 401 || response.status === 403) {
    console.log('rdlogs: ,',response.body)
    const requestId = response.headers.get('x-routstr-request-id');
    const mainMessage = response.body?.toString() + ". Trying to get a refund.";
    const requestIdText = requestId ? `Request ID: ${requestId}` : '';
    const providerText = `Provider: ${baseUrl}`;
    const fullMessage = requestId
      ? `${mainMessage}\n${requestIdText}\n${providerText}`
      : `${mainMessage} | ${providerText}`;
    logApiError(fullMessage, onMessageAppend);
    const storedToken = getLocalCashuToken(baseUrl);
    let shouldAttemptUnifiedRefund = true;

    if (storedToken) {
      try {
        await storeCashu(storedToken);
        shouldAttemptUnifiedRefund = false;
      } catch (receiveError) {
        if (receiveError instanceof Error && receiveError.message.includes('Token already spent')) {
          shouldAttemptUnifiedRefund = true;
        } else {
          console.error("Error receiving token:", receiveError);
          shouldAttemptUnifiedRefund = true;
        }
      }
    }

    if (shouldAttemptUnifiedRefund) {
      const refundStatus = await unifiedRefund(mintUrl, baseUrl, usingNip60, storeCashu);
      if (!refundStatus.success){
        const mainMessage = `Refund failed: ${refundStatus.message}.`;
        const requestIdText = refundStatus.requestId ? `Request ID: ${refundStatus.requestId}` : '';
        const providerText = `Provider: ${baseUrl}`;
        const fullMessage = refundStatus.requestId
          ? `${mainMessage}\n${requestIdText}\n${providerText}`
          : `${mainMessage} | ${providerText}`;
        logApiError(fullMessage, onMessageAppend);
      }
    }
    
    removeLocalCashuToken(baseUrl); // Pass baseUrl here
    
    if (retryOnInsufficientBalance) {
      const newToken = await spendCashu(
        mintUrl,
        tokenAmount,
        baseUrl
      );

      if (!newToken || (typeof newToken === 'object' && 'hasTokens' in newToken && !newToken.hasTokens)) {
        throw new Error(`Insufficient balance (retryOnInsurrifientBal). Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`);
      }
    }
  } 
  else if (response.status === 402) {
    removeLocalCashuToken(baseUrl); // Pass baseUrl here
  } 
  else if (response.status === 413) {
    const refundStatus = await unifiedRefund(mintUrl, baseUrl, usingNip60, storeCashu);
    if (!refundStatus.success){
      const mainMessage = `Refund failed: ${refundStatus.message}.`;
      const requestIdText = refundStatus.requestId ? `Request ID: ${refundStatus.requestId}` : '';
      const providerText = `Provider: ${baseUrl}`;
      const fullMessage = refundStatus.requestId
        ? `${mainMessage}\n${requestIdText}\n${providerText}`
        : `${mainMessage} | ${providerText}`;
      logApiError(fullMessage, onMessageAppend);
    }
  }
  else if (response.status === 500) {
    console.error("rdlogs:rdlogs:internal errror finassld");
  }
  else {
    console.error("rdlogs:rdlogs:smh else else ", response);
  }

  if (!retryOnInsufficientBalance) {
    throw new Error(`API error: ${response.status}`);
  }
}

/**
 * Image type from API response
 */
interface ImageData {
  type: 'image_url';
  image_url: {
    url: string;
  };
  index?: number;
}

/**
 * Merges new images into the accumulated images array, avoiding duplicates
 * @param accumulatedImages Current array of images
 * @param newImages New images to merge
 */
function mergeImages(accumulatedImages: ImageData[], newImages: ImageData[]): void {
  newImages.forEach((img) => {
    const existingIndex = accumulatedImages.findIndex(
      (existing) => existing.index === img.index
    );
    if (existingIndex === -1) {
      accumulatedImages.push(img);
    } else {
      accumulatedImages[existingIndex] = img;
    }
  });
}

/**
 * Creates an assistant message from streaming result
 * @param streamingResult The result from streaming response
 * @returns Assistant message with text, images, and optional thinking
 */
function createAssistantMessage(streamingResult: StreamingResult): Message {
  const hasImages = streamingResult.images && streamingResult.images.length > 0;
  
  if (hasImages) {
    // Create multimodal message with text and images
    const content: MessageContent[] = [];
    
    if (streamingResult.content) {
      content.push({ type: 'text', text: streamingResult.content });
    }
    
    streamingResult.images!.forEach(img => {
      content.push({
        type: 'image_url',
        image_url: { url: img.image_url.url }
      });
    });
    
    const message: Message = {
      role: 'assistant',
      content
    };
    
    if (streamingResult.thinking) {
      message.thinking = streamingResult.thinking;
    }
    
    return message;
  }
  
  // Create simple text message
  const message = createTextMessage('assistant', streamingResult.content);
  if (streamingResult.thinking) {
    message.thinking = streamingResult.thinking;
  }
  
  return message;
}

/**
 * Usage statistics from API response
 */
interface UsageStats {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * Result type for both streaming and non-streaming responses
 */
interface StreamingResult {
  content: string;
  thinking?: string;
  images?: ImageData[];
  usage?: UsageStats;
  model?: string;
  finish_reason?: string;
}

/**
 * Processes non-streaming (complete) response from the API
 * @param response The fetch response object
 * @param onStreamingUpdate Callback to update streaming content
 * @param onThinkingUpdate Callback to update thinking content
 * @param modelId Optional model ID for thinking-capable model handling
 * @returns Parsed streaming result with content, images, and metadata
 */
async function processNonStreamingResponse(
  response: Response,
  onStreamingUpdate: (content: string) => void,
  onThinkingUpdate: (content: string) => void,
  modelId?: string
): Promise<StreamingResult> {
  const data = await response.json();
  
  let content = '';
  let thinking = '';
  let images: StreamingResult['images'];
  let usage: StreamingResult['usage'];
  let model: string | undefined;
  let finish_reason: string | undefined;

  // Extract data from the response
  if (data.choices && data.choices[0]) {
    const choice = data.choices[0];
    
    // Extract content
    if (choice.message?.content) {
      content = choice.message.content;
      onStreamingUpdate(content);
    }
    
    // Extract images
    if (choice.message?.images && Array.isArray(choice.message.images)) {
      images = choice.message.images;
    }
    
    // Extract finish reason
    if (choice.finish_reason) {
      finish_reason = choice.finish_reason;
    }
  }
  
  // Extract usage statistics
  if (data.usage) {
    usage = {
      total_tokens: data.usage.total_tokens,
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens
    };
  }
  
  // Extract model
  if (data.model) {
    model = data.model;
  }

  return {
    content,
    thinking,
    images,
    usage,
    model,
    finish_reason
  };
}

/**
 * Processes streaming SSE response from the API with line buffering for large payloads
 * Handles incomplete JSON chunks by buffering lines until complete
 * @param response The fetch response object with streaming body
 * @param onStreamingUpdate Callback to update streaming content as it arrives
 * @param onThinkingUpdate Callback to update thinking content as it arrives
 * @param modelId Optional model ID for thinking-capable model handling
 * @returns Parsed streaming result with accumulated content, images, and metadata
 */
async function processStreamingResponse(
  response: Response,
  onStreamingUpdate: (content: string) => void,
  onThinkingUpdate: (content: string) => void,
  modelId?: string
): Promise<StreamingResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let accumulatedContent = '';
  let accumulatedThinking = '';
  let isInThinking = false;
  let isInContent = false;
  let accumulatedImages: ImageData[] = [];
  let usage: UsageStats | undefined;
  let model: string | undefined;
  let finish_reason: string | undefined;
  
  // Buffer for incomplete lines - critical for handling large base64 image data
  // that may be split across multiple stream chunks
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;

    try {
      const lines = buffer.split('\n');
      
      // Keep the last element in buffer as it may be an incomplete line
      // (Stream chunks can break in the middle of JSON data)
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith('data: ')) {
          const jsonData = line.slice(6);

          if (jsonData === '[DONE]') continue;

          try {
            const parsedData = JSON.parse(jsonData);

            // Handle reasoning delta. OpenRouter does this. 
            if (parsedData.choices &&
              parsedData.choices[0] &&
              parsedData.choices[0].delta &&
              parsedData.choices[0].delta.reasoning) {
              
                let newContent;
                if (!isInThinking) {
                  newContent = "<thinking> " + parsedData.choices[0].delta.reasoning;
                  isInThinking = true;
                }
                else {
                  newContent = parsedData.choices[0].delta.reasoning;
                }
                const thinkingResult = extractThinkingFromStream(newContent, accumulatedThinking);
                accumulatedThinking = thinkingResult.thinking;
                onThinkingUpdate(accumulatedThinking)
              }

            // Handle content delta
            else if (parsedData.choices &&
              parsedData.choices[0] &&
              parsedData.choices[0].delta &&
              parsedData.choices[0].delta.content) {

              if (isInThinking && !isInContent) {
                const newContent = "</thinking>";
                const thinkingResult = extractThinkingFromStream(newContent, accumulatedThinking);
                accumulatedThinking = thinkingResult.thinking;
                onThinkingUpdate(accumulatedThinking);
                
                if (thinkingResult.content) {
                  accumulatedContent += thinkingResult.content;
                  onStreamingUpdate(accumulatedContent);
                }
                isInThinking = false;
                isInContent = true;
              }

              const newContent = parsedData.choices[0].delta.content;
              
              if (modelId && isThinkingCapableModel(modelId)) {
                const thinkingResult = extractThinkingFromStream(newContent, accumulatedThinking);
                accumulatedThinking = thinkingResult.thinking;
                isInThinking = thinkingResult.isInThinking;
                onThinkingUpdate(accumulatedThinking);
                
                if (thinkingResult.content) {
                  accumulatedContent += thinkingResult.content;
                  onStreamingUpdate(accumulatedContent);
                }
              } else {
                accumulatedContent += newContent;
                onStreamingUpdate(accumulatedContent);
              }
            }

            // Handle usage statistics (usually in the final chunk)
            if (parsedData.usage) {
              usage = {
                total_tokens: parsedData.usage.total_tokens,
                prompt_tokens: parsedData.usage.prompt_tokens,
                completion_tokens: parsedData.usage.completion_tokens
              };
            }

            // Handle model information
            if (parsedData.model) {
              model = parsedData.model;
            }

            // Handle finish reason
            if (parsedData.choices &&
              parsedData.choices[0] &&
              parsedData.choices[0].finish_reason) {
              finish_reason = parsedData.choices[0].finish_reason;
            }

            // Handle images in the message (for models that generate images)
            // This typically arrives in the final complete chunk before [DONE]
            if (parsedData.choices?.[0]?.message?.images && 
                Array.isArray(parsedData.choices[0].message.images)) {
              mergeImages(accumulatedImages, parsedData.choices[0].message.images);
            }

            // Handle images in delta (for streaming image generation)
            // Some models may send images incrementally in delta chunks
            if (parsedData.choices?.[0]?.delta?.images && 
                Array.isArray(parsedData.choices[0].delta.images)) {
              mergeImages(accumulatedImages, parsedData.choices[0].delta.images);
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

  return {
    content: accumulatedContent,
    thinking: (modelId && accumulatedThinking) ? accumulatedThinking : undefined,
    images: accumulatedImages.length > 0 ? accumulatedImages : undefined,
    usage,
    model,
    finish_reason
  };
}

/**
 * Handles refund and balance updates after successful response
 */
async function handlePostResponseRefund(params: {
  mintUrl: string;
  baseUrl: string;
  usingNip60: boolean;
  storeCashu: (token: string) => Promise<any[]>;
  tokenAmount: number;
  initialBalance: number;
  selectedModel: any;
  onBalanceUpdate: (balance: number) => void;
  onTransactionUpdate: (transaction: TransactionHistory) => void;
  transactionHistory: TransactionHistory[];
  messageHistory: Message[];
  onMessagesUpdate: (messages: Message[]) => void;
  onMessageAppend: (message: Message) => void;
  estimatedCosts: number; // Add estimatedCosts here
  unit: string; // Add unit here
}): Promise<void> {
  const {
    mintUrl,
    baseUrl,
    usingNip60,
    storeCashu,
    tokenAmount,
    initialBalance,
    selectedModel,
    onBalanceUpdate,
    onTransactionUpdate,
    transactionHistory,
    messageHistory,
    onMessagesUpdate,
    onMessageAppend,
    estimatedCosts, // Destructure estimatedCosts here
    unit // Destructure unit here
  } = params;

  let satsSpent: number;


  const refundStatus = await unifiedRefund(mintUrl, baseUrl, usingNip60, storeCashu);
  if (refundStatus.success) {
    if (usingNip60 && refundStatus.refundedAmount !== undefined) {
      // For msats, keep decimal precision; for sats, use Math.ceil
      satsSpent = (unit === 'msat' ? tokenAmount : Math.ceil(tokenAmount)) - refundStatus.refundedAmount;
      onBalanceUpdate(initialBalance - satsSpent);
    } else {
      const { apiBalance, proofsBalance } = await fetchBalances(mintUrl, baseUrl);
      onBalanceUpdate(Math.floor(apiBalance / 1000) + Math.floor(proofsBalance / 1000));
      satsSpent = initialBalance - getBalanceFromStoredProofs();
    }
  } else {
    console.error("Refund failed:", refundStatus.message, refundStatus, refundStatus, refundStatus, refundStatus, refundStatus);
    if (refundStatus.message && refundStatus.message.includes("Balance too small to refund")) {
      removeLocalCashuToken(baseUrl); // Pass baseUrl here
    }
    else if (refundStatus.message && refundStatus.message.includes("Refund request failed with status 401")) {
      const mainMessage = `Refund failed: ${refundStatus.message}. Clearing token. Pls retry.`;
      const requestIdText = refundStatus.requestId ? `Request ID: ${refundStatus.requestId}` : '';
      const providerText = `Provider: ${baseUrl}`;
      const fullMessage = refundStatus.requestId
        ? `${mainMessage}\n${requestIdText}\n${providerText}`
        : `${mainMessage} | ${providerText}`;
      logApiError(fullMessage, onMessageAppend);
      removeLocalCashuToken(baseUrl); // Pass baseUrl here
    }
    else {
      const mainMessage = `Refund failed: ${refundStatus.message}.`;
      const requestIdText = refundStatus.requestId ? `Request ID: ${refundStatus.requestId}` : '';
      const providerText = `Provider: ${baseUrl}`;
      const fullMessage = refundStatus.requestId
        ? `${mainMessage}\n${requestIdText}\n${providerText}`
        : `${mainMessage} | ${providerText}`;
      logApiError(fullMessage, onMessageAppend);
    }
    // For msats, keep decimal precision; for sats, use Math.ceil
    satsSpent = unit === 'msat' ? tokenAmount : Math.ceil(tokenAmount);
  }
  console.log("spent: ", satsSpent)
  const netCosts = satsSpent - estimatedCosts;
  
  // Use different thresholds based on unit
  const overchargeThreshold = unit === 'msat' ? 0.05 : 1;
  if (netCosts > overchargeThreshold){
    const estimatedDisplay = unit === 'msat' ? estimatedCosts.toFixed(3) : Math.ceil(estimatedCosts).toString();
    const actualDisplay = unit === 'msat' ? satsSpent.toFixed(3) : satsSpent.toString();
    logApiError("ATTENTION: Looks like this provider is overcharging you for your query. Estimated Costs: " + estimatedDisplay +". Actual Costs: " + actualDisplay, onMessageAppend);
  }

  const newTransaction: TransactionHistory = {
    type: 'spent',
    amount: satsSpent,
    timestamp: Date.now(),
    status: 'success',
    model: selectedModel?.id,
    message: 'Tokens spent',
    balance: initialBalance - satsSpent
  };

  localStorage.setItem('transaction_history', JSON.stringify([...transactionHistory, newTransaction]));
  onTransactionUpdate(newTransaction);
}

/**
 * Handles errors in API responses and adds error messages to chat
 */
function logApiError(
  error: unknown,
  onMessageAppend: (message: Message) => void
): void {
  let errorMessage = 'Failed to process your request';
  
  if (error instanceof TypeError && error.message.includes('NetworkError when attempting to fetch resource.')) {
    errorMessage = 'Your provider is down. Please switch the provider in settings.';
  } else {
    errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : 'Failed to process your request');
  }

  onMessageAppend(createTextMessage('system', errorMessage));
}