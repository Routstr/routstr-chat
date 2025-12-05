import { Message, MessageContent, TransactionHistory } from '@/types/chat';
import { convertMessageForAPI, createTextMessage, extractThinkingFromStream } from './messageUtils';
import { fetchBalances, getBalanceFromStoredProofs, getPendingCashuTokenAmount, refundRemainingBalance, unifiedRefund, UnifiedRefundResult } from '@/utils/cashuUtils';
import { getLocalCashuToken, removeLocalCashuToken, getStorageItem, loadDisabledProviders, getOrFetchProviderInfo } from './storageUtils';
import { getDecodedToken } from '@cashu/cashu-ts';
import { isThinkingCapableModel } from './thinkingParser';
import { SpendCashuResult } from '@/hooks/useCashuWithXYZ';
import { Model } from '@/data/models';
import { getModelForBase, getRequiredSatsForModel } from './modelUtils';


export interface FetchAIResponseParams {
  messageHistory: Message[];
  selectedModel: any;
  baseUrl: string;
  mintUrl: string;
  usingNip60: boolean;
  balance: number;
  spendCashu: (mintUrl: string, amount: number, baseUrl: string, reuseToken?: boolean, p2pkPubkey?: string) => Promise<SpendCashuResult>;
  storeCashu: (token: string) => Promise<any[]>;
  activeMintUrl?: string | null;
  onStreamingUpdate: (content: string) => void;
  onThinkingUpdate: (content: string) => void;
  onMessageAppend: (message: Message) => void;
  onBalanceUpdate: (balance: number) => void;
  onTransactionUpdate: (transaction: TransactionHistory) => void;
  transactionHistory: TransactionHistory[];
  onTokenCreated: (amount: number) => void;
}

interface APIErrorVerdict {
  retry: boolean;
  reason: string;
  newBaseUrl?: string; // New provider to retry with (for 50X errors)
}

/**
 * Finds the next best provider for a model based on price
 * @param modelId The model ID to find a provider for
 * @param currentBaseUrl The current provider URL to exclude
 * @param failedProviders Set of provider URLs that have already failed
 * @returns The next best provider URL or null if none available
 */
function findNextBestProvider(
  modelId: string,
  currentBaseUrl: string,
  failedProviders: Set<string>
): string | null {
  try {
    // Load all cached provider models from storage
    const modelsFromAllProviders = getStorageItem<Record<string, Model[]>>('modelsFromAllProviders', {});
    
    // Find all providers that offer this model
    const candidateProviders: Array<{ baseUrl: string; model: Model; cost: number }> = [];
    
    const disabledProviders = new Set<string>(loadDisabledProviders())
    
    for (const [baseUrl, models] of Object.entries(modelsFromAllProviders)) {
      // Skip current provider and failed providers
      if (baseUrl === currentBaseUrl || failedProviders.has(baseUrl) || disabledProviders.has(baseUrl)) {
        continue;
      }
      console.log('checking ', modelId, baseUrl)
      if (baseUrl === "https://api.routstr.com/") {
        console.log("ALL MODLES", models)
      }
      
      // Find the model in this provider's list
      const model = models.find((m: Model) => m.id === modelId);
      if (!model) continue;
      
      // Calculate cost (same logic as useApiState.ts)
      const cost = model?.sats_pricing?.completion ?? 0;
      
      candidateProviders.push({ baseUrl, model, cost });
    }
    
    // Sort by price (lowest first)
    candidateProviders.sort((a, b) => a.cost - b.cost);
    
    // Return the cheapest provider
    return candidateProviders.length > 0 ? candidateProviders[0].baseUrl : null;
  } catch (error) {
    console.error('Error finding next best provider:', error);
    return null;
  }
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
  spendCashu: (mintUrl: string, amount: number, baseUrl: string, reuseToken?: boolean, p2pkPubkey?: string) => Promise<SpendCashuResult>;
  storeCashu: (token: string) => Promise<any[]>;
  activeMintUrl?: string | null;
  onMessageAppend: (message: Message) => void;
  token: string;
  retryOnInsufficientBalance?: boolean;
  failedProviders?: Set<string>; // Track providers that have returned 50X errors
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
    retryOnInsufficientBalance = true,
    failedProviders = new Set<string>()
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
  const providerInfo = await getOrFetchProviderInfo(baseUrl);
  const providerVersion = providerInfo?.version ?? '';
  console.log("rdlogs: rdlogs: headers: ", baseUrl, providerVersion)
  
  // For provider version 0.1.X, send only the leaf ID (after the last '/')
  let modelIdForRequest = selectedModel.id;
  if (/^0\.1\./.test(providerVersion)) {
    const newModelInfo = await backwardCompatibleModel(selectedModel.id, baseUrl);
    modelIdForRequest = newModelInfo?.id ?? selectedModel.id;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelIdForRequest,
        messages: apiMessages,
        stream: true
      })
    });
  } catch (error: any) {
    // Handle network fetch errors and attempt provider failover
    const message = typeof error?.message === 'string' ? error.message : '';
    const isNetworkError =
      error instanceof TypeError ||
      message.includes('NetworkError when attempting to fetch resource') ||
      message.includes('Failed to fetch') ||
      message.includes('Load failed');

    if (isNetworkError) {
      const refundStatus = await unifiedRefund(mintUrl, baseUrl, usingNip60, storeCashu);
      if (!refundStatus.success){
        await logApiErrorForRefund(refundStatus, baseUrl, onMessageAppend);
      }
    
      // Mark current provider as failed and try the next best one
      failedProviders.add(baseUrl);
      const nextProvider = findNextBestProvider(selectedModel?.id, baseUrl, failedProviders);

      if (nextProvider) {
        onMessageAppend(createTextMessage('system', `Provider ${baseUrl} is unreachable. Retrying with ${nextProvider}...`));

        const newBaseModel = await getModelForBase(nextProvider, selectedModel.id) ?? selectedModel;
        const tokenAmountNew = getRequiredSatsForModel(newBaseModel, apiMessages);

        // Acquire a new token for the next provider and retry recursively
        const newTokenResult = await spendCashu(mintUrl, tokenAmountNew, nextProvider, true);
        if (newTokenResult.status === 'failed' || !newTokenResult.token) {
          throw new Error(
            newTokenResult.error ||
            `Insufficient balance. Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`
          );
        }

        const newResponse = await routstrRequest({
          apiMessages,
          selectedModel: newBaseModel,
          baseUrl: nextProvider,
          mintUrl,
          usingNip60,
          tokenAmount,
          spendCashu,
          storeCashu,
          activeMintUrl,
          onMessageAppend,
          token: newTokenResult.token,
          retryOnInsufficientBalance: false,
          failedProviders
        });

        (newResponse as any).tokenBalance = tokenAmount;
        return newResponse;
      }
    }

    // If not a recognized network error or no alternate provider available, rethrow
    throw error;
  }

  if (!response.ok) {
    const retryVerdict = await handleApiError(response, {
      mintUrl,
      baseUrl,
      usingNip60,
      storeCashu,
      tokenAmount,
      selectedModel,
      spendCashu,
      activeMintUrl,
      retryOnInsufficientBalance,
      onMessageAppend,
      failedProviders
    });
    if (retryVerdict.retry) {
      // Use new baseUrl if switching providers (for 50X errors)
      const retryBaseUrl = retryVerdict.newBaseUrl || baseUrl;
      let newSelectedModel = selectedModel;

      newSelectedModel = await getModelForBase(retryBaseUrl, selectedModel?.id)
      const tokenAmountNew = getRequiredSatsForModel(newSelectedModel, apiMessages)
      
      const newTokenResult = await spendCashu(mintUrl, tokenAmountNew, retryBaseUrl, true); // reuse token is true here but the two scenarios where we're retrying remove locally stored token anyway. 
      if (newTokenResult.status === 'failed' || !newTokenResult.token) {
        throw new Error(newTokenResult.error || `Insufficient balance. Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`);
      }
      const newToken = newTokenResult.token;
      const newResponse = await routstrRequest({
        apiMessages,
        selectedModel: newSelectedModel,
        baseUrl: retryBaseUrl,
        mintUrl,
        usingNip60,
        tokenAmount: tokenAmountNew,
        spendCashu,
        storeCashu,
        onMessageAppend,
        token: newToken,
        retryOnInsufficientBalance: false,
        failedProviders
      });
      
      (newResponse as any).tokenBalance = tokenAmount;
      return newResponse;
    }
  }

  (response as any).baseUrl = baseUrl;
  return response;
}

/**
 * Fetches AI response from the API with streaming support
 * @param params Configuration object with all required parameters
 * @returns Promise that resolves when the response is complete
 */


export const fetchAIResponse = async (params: FetchAIResponseParams): Promise<void> => {
  const {
    messageHistory,
    selectedModel,
    baseUrl,
    mintUrl,
    usingNip60,
    balance,
    spendCashu,
    storeCashu,
    activeMintUrl,
    onStreamingUpdate,
    onThinkingUpdate,
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
  
  const tokenAmount = getRequiredSatsForModel(selectedModel, apiMessages);
  let tokenBalance = 0;

  try {
    const storedToken = getLocalCashuToken(baseUrl);

    const result = await spendCashu(
      mintUrl,
      tokenAmount,
      baseUrl,
      true
    );

    if (result.status === 'failed' || !result.token) {
      const errorMessage = result.error || `Insufficient balance. Please add more funds to continue. You need at least ${Number(tokenAmount).toFixed(0)} sats to use ${selectedModel?.id}`;
      
      // Check for specific network/unreachable mint errors
      if (
        errorMessage.includes("can't access property \"filter\", keysets.keysets is undefined") ||
        errorMessage.includes("NetworkError when attempting to fetch resource") ||
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("Load failed")
      ) {
        throw new Error(`Your mint ${mintUrl} is unreachable or is blocking your IP. Please try again later or switch mints`);
      }
      
      throw new Error(errorMessage);
    }

    const token = result.token;

    if (storedToken == token) {
      try {
        const response = await fetch(`${baseUrl}v1/wallet/info`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();
        tokenBalance = data.balance;
      } catch (error) {
        tokenBalance = tokenAmount;
      }
    }
    else {
      tokenBalance = tokenAmount;
    }

    onTokenCreated(getPendingCashuTokenAmount())
  
    // Track providers that have returned 50X errors for automatic failover
    const failedProviders = new Set<string>();
    
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
      retryOnInsufficientBalance: true,
      failedProviders
    });
    console.log("rdlogs: rdlogs: response: ", response)
    // const response = new Response();

    if (response instanceof Response && (response as any).tokenBalance) {
      tokenBalance = (response as any).tokenBalance; // if a new token was created and we had set a stored token balance beforehand. 
    }

    if (!response.body) {
      throw new Error('Response body is not available');
    }

    // Handle refund and balance update
    if (response.status === 200) {
      const baseUrlUsed = (response as any).baseUrl;

      const streamingResult = await processStreamingResponse(response, onStreamingUpdate, onThinkingUpdate, selectedModel?.id); 
      console.log("STREMING RESULTS", streamingResult);
      if (streamingResult.finish_reason === "content_filter") {
        onMessageAppend(createTextMessage('assistant', "Your request was denied due to content filtering. "))
      }
      else if (streamingResult.content || streamingResult.images) {
        const hasImages = streamingResult.images && streamingResult.images.length > 0;
        if (streamingResult.content === "<image>" && !hasImages) {
          onMessageAppend(createTextMessage('assistant', "This model has issues when using through OpenRouter. We're working on finding alternatives. "))
        }
        else {
          onMessageAppend(createAssistantMessage(streamingResult));
        }
      }
      else {
        logApiError("The provider did not respond to this request. ", onMessageAppend)
      }

      let estimatedCosts = 0; // Initialize to 0
      // Log usage statistics if available
      if (streamingResult.usage) {
        if ( streamingResult.usage.completion_tokens !== undefined && streamingResult.usage.prompt_tokens !== undefined) {
          estimatedCosts = selectedModel?.sats_pricing.completion * streamingResult.usage.completion_tokens + selectedModel?.sats_pricing.prompt * streamingResult.usage.prompt_tokens
          console.log("prompt TOKENS", streamingResult.usage.prompt_tokens);
          console.log("Estimated costs: ", estimatedCosts);
        }
      }

      onStreamingUpdate('');
      onThinkingUpdate('');

      await handlePostResponseRefund({
        mintUrl,
        baseUrl: baseUrlUsed,
        usingNip60,
        storeCashu,
        tokenBalance,
        initialBalance,
        selectedModel,
        onBalanceUpdate,
        onTransactionUpdate,
        transactionHistory,
        onMessageAppend,
        estimatedCosts,
        unit: getDecodedToken(token).unit ?? 'sat'
      });
    }
    else {
      throw new Error(`${response.status} ${response.statusText}`);
    }

  } catch (error) {
    console.log('API Error: ', error);
    const isDev = process.env.NODE_ENV === 'development';
    const isBeta = typeof window !== 'undefined' && window.location.origin === 'https://beta.chat.routstr.com';
    
    if (error instanceof Error) {
      const errorMsg = 'Error in fetchAIReponse: ' + error.message + ((isDev || isBeta) ? ' | ' + error.stack : '');
      logApiError(errorMsg, onMessageAppend);
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
    spendCashu: (mintUrl: string, amount: number, baseUrl: string, reuseToken?: boolean, p2pkPubkey?: string) => Promise<SpendCashuResult>;
    activeMintUrl?: string | null;
    retryOnInsufficientBalance?: boolean;
    onMessageAppend: (message: Message) => void;
    failedProviders?: Set<string>;
  }
): Promise<APIErrorVerdict> {
  const {
    mintUrl,
    baseUrl,
    usingNip60,
    storeCashu,
    tokenAmount,
    selectedModel,
    spendCashu,
    activeMintUrl,
    retryOnInsufficientBalance = true,
    onMessageAppend,
    failedProviders = new Set<string>()
  } = params;

  if (response.status === 401 || response.status === 403 || response.status === 402 || response.status === 413) {
    if (response.status !== 402) {
      await logApiErrorForResponse(response, baseUrl, onMessageAppend);
    }
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
        await logApiErrorForRefund(refundStatus, baseUrl, onMessageAppend);
      }
    }
    
    removeLocalCashuToken(baseUrl); // Pass baseUrl here
    // Mark current provider as failed
    failedProviders.add(baseUrl);
    
    // Try to find next best provider for 50X errors
    const nextProvider = findNextBestProvider(selectedModel?.id, baseUrl, failedProviders);
    console.log("Fidning next probi", nextProvider);
    
    if (nextProvider) {
      console.log(`Provider ${baseUrl} returned ${response.status}, switching to ${nextProvider}`);
      onMessageAppend(createTextMessage('system', `Provider ${baseUrl} is experiencing issues. Retrying with ${nextProvider}...`));
      return { retry: true, reason: response.status.toString(), newBaseUrl: nextProvider };
    }

    return { retry: retryOnInsufficientBalance, reason: response.status.toString() };
  }
  else if (response.status === 400) {
    const errorMessage = await readResponseBodyText(response);
    console.error("rdlogs:rdlogs:smh 400 error: ", errorMessage);
    if (errorMessage.includes("is not a valid model ID")) {
      return { retry: retryOnInsufficientBalance, reason: "not a valid model ID" };
    }
    else if (/Model\s+'[^']+'\s+not found/.test(errorMessage)) {
      const refundStatus = await unifiedRefund(mintUrl, baseUrl, usingNip60, storeCashu);
      if (!refundStatus.success){
        await logApiErrorForRefund(refundStatus, baseUrl, onMessageAppend);
      }
    
      // Mark current provider as failed
      failedProviders.add(baseUrl);
      
      // Try to find next best provider for 50X errors
      const nextProvider = findNextBestProvider(selectedModel?.id, baseUrl, failedProviders);
      
      if (nextProvider) {
        console.log(`Provider ${baseUrl} returned ${response.status}, switching to ${nextProvider}`);
        onMessageAppend(createTextMessage('system', `Provider ${baseUrl} is experiencing issues. Retrying with ${nextProvider}...`));
        return { retry: true, reason: response.status.toString(), newBaseUrl: nextProvider };
      }
      return { retry: retryOnInsufficientBalance, reason: "model not found" };
    }
    await logApiErrorForResponse(response, baseUrl, onMessageAppend, errorMessage);
    return { retry: false, reason: response.status.toString() };
  }
  else if (response.status === 500 || response.status === 502) {
    await logApiErrorForResponse(response, baseUrl, onMessageAppend);
    const refundStatus = await unifiedRefund(mintUrl, baseUrl, usingNip60, storeCashu);
    if (!refundStatus.success){
      await logApiErrorForRefund(refundStatus, baseUrl, onMessageAppend);
    }
    
    // Mark current provider as failed
    failedProviders.add(baseUrl);
    
    // Try to find next best provider for 50X errors
    const nextProvider = findNextBestProvider(selectedModel?.id, baseUrl, failedProviders);
    
    if (nextProvider) {
      console.log(`Provider ${baseUrl} returned ${response.status}, switching to ${nextProvider}`);
      onMessageAppend(createTextMessage('system', `Provider ${baseUrl} is experiencing issues. Retrying with ${nextProvider}...`));
      return { retry: true, reason: response.status.toString(), newBaseUrl: nextProvider };
    }
    
    return { retry: false, reason: response.status.toString() };
  }
  else {
    console.error("rdlogs:rdlogs:smh else else ", response);
    const errorMessage = await response.text();
    logApiError(errorMessage, onMessageAppend);
    return { retry: false, reason: response.status.toString() };
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
        else {
          console.log(accumulatedContent, accumulatedThinking)
          console.log(line)
          if (accumulatedContent === '' && accumulatedThinking === '' && !line.includes('OPENROUTER PROCESSING'))
            onStreamingUpdate("Generating...")
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
  tokenBalance: number;
  initialBalance: number;
  selectedModel: any;
  onBalanceUpdate: (balance: number) => void;
  onTransactionUpdate: (transaction: TransactionHistory) => void;
  transactionHistory: TransactionHistory[];
  onMessageAppend: (message: Message) => void;
  estimatedCosts: number; // Add estimatedCosts here
  unit: string; // Add unit here
}): Promise<void> {
  const {
    mintUrl,
    baseUrl,
    usingNip60,
    storeCashu,
    tokenBalance,
    initialBalance,
    selectedModel,
    onBalanceUpdate,
    onTransactionUpdate,
    transactionHistory,
    onMessageAppend,
    estimatedCosts, // Destructure estimatedCosts here
    unit // Destructure unit here
  } = params;

  let satsSpent: number;


  const refundStatus = await unifiedRefund(mintUrl, baseUrl, usingNip60, storeCashu);
  if (refundStatus.success) {
    if (refundStatus.message && refundStatus.message.includes("No API key to refund")) {
      satsSpent = 0;
    }
    else if (refundStatus.refundedAmount === undefined) {
      satsSpent = tokenBalance;
    }
    else {
      if (usingNip60) {
        // For msats, keep decimal precision; for sats, use Math.ceil
        satsSpent = (unit === 'msat' ? tokenBalance : Math.ceil(tokenBalance)) - refundStatus.refundedAmount;
        onBalanceUpdate(initialBalance - satsSpent);
      } else {
        const { apiBalance, proofsBalance } = await fetchBalances(mintUrl, baseUrl);
        onBalanceUpdate(Math.floor(apiBalance / 1000) + Math.floor(proofsBalance / 1000));
        satsSpent = initialBalance - getBalanceFromStoredProofs();
      }
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
      await logApiErrorForRefund(refundStatus, baseUrl, onMessageAppend);
    }
    // For msats, keep decimal precision; for sats, use Math.ceil
    satsSpent = unit === 'msat' ? tokenBalance : Math.ceil(tokenBalance);
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
 * Helper function to properly read response body text from a ReadableStream
 */
async function readResponseBodyText(response: Response): Promise<string> {
  if (!response.body) {
    return '';
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  
  return text;
}


async function logApiErrorForResponse(response: Response, baseUrl: string, onMessageAppend: (message: Message) => void, errorMessage?: string): Promise<void> {
  const responseBodyText = errorMessage || await readResponseBodyText(response);
  const requestId = response.headers.get('x-routstr-request-id');
  const mainMessage = responseBodyText + ". Trying to get a refund.";
  const requestIdText = requestId ? `Request ID: ${requestId}` : '';
  const providerText = `Provider: ${baseUrl}`;
  const fullMessage = requestId
    ? `${mainMessage}\n${requestIdText}\n${providerText}`
    : `${mainMessage} | ${providerText}`;
  logApiError(fullMessage, onMessageAppend);
}

async function logApiErrorForRefund(refundStatus: UnifiedRefundResult, baseUrl: string, onMessageAppend: (message: Message) => void): Promise<void> {
  const mainMessage = `Refund failed: ${refundStatus.message}.`;
  const requestIdText = refundStatus.requestId ? `Request ID: ${refundStatus.requestId}` : '';
  const providerText = `Provider: ${baseUrl}`;
  const fullMessage = refundStatus.requestId
    ? `${mainMessage}\n${requestIdText}\n${providerText}`
    : `${mainMessage} | ${providerText}`;
  logApiError(fullMessage, onMessageAppend);
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

async function backwardCompatibleModel(selectedModel: string, baseUrl: string): Promise<Model | null> {
  try {
    const response = await fetch(`${baseUrl}v1/models`);
    if (!response.ok) {
      console.error(`Failed to fetch models: ${response.status}`);
      return null;
    }
    const json = await response.json();
    const models = Array.isArray(json?.data) ? json.data : [];
    return models.find((m: Model) => m.id.split('/')[1] === selectedModel) || null;
  } catch (error) {
    console.error("Error fetching models:", error);
    return null;
  }
}
