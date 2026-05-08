/**
 * Core types for the Routstr SDK
 * These types are shared across wallet and client modules
 */

export interface SdkLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  child(prefix: string): SdkLogger;
}

function makeConsoleLogger(prefix?: string): SdkLogger {
  const fmt = (args: unknown[]) => (prefix ? [prefix, ...args] : args);
  return {
    log: (...args) => console.log(...fmt(args)),
    warn: (...args) => console.warn(...fmt(args)),
    error: (...args) => console.error(...fmt(args)),
    debug: (...args) => console.log(...fmt(args)),
    child: (p) => makeConsoleLogger(prefix ? `${prefix}:${p}` : p),
  };
}

export const consoleLogger: SdkLogger = makeConsoleLogger();

export const noopLogger: SdkLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

export interface MessageContentType {
  type: "text" | "image_url" | "file";
  text?: string;
  image_url?: {
    url: string;
    storageId?: string;
  };
  file?: {
    url: string;
    name?: string;
    mimeType?: string;
    size?: number;
  };
  hidden?: boolean;
  thinking?: string;
  citations?: string[];
}

export interface Message {
  role: string;
  content: string | MessageContentType[];
  _eventId?: string;
  _prevId?: string;
  _createdAt?: number;
  _modelId?: string;
  satsSpent?: number;
}

export interface TransactionHistory {
  type: "spent" | "mint" | "send" | "import" | "refund";
  amount: number;
  timestamp: number;
  status: "success" | "failed";
  model?: string;
  message?: string;
  balance?: number;
}

export interface ModelPricing {
  prompt: number;
  completion: number;
  request: number;
  image: number;
  web_search: number;
  internal_reasoning: number;
}

export interface ModelSatsPricing extends ModelPricing {
  max_completion_cost: number;
  max_prompt_cost: number;
  max_cost: number;
}

export interface ModelArchitecture {
  modality: string;
  input_modalities: readonly string[];
  output_modalities: readonly string[];
  tokenizer: string;
  instruct_type: string | null;
}

export interface PerRequestLimits {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly requests_per_minute?: number;
  readonly images_per_minute?: number;
  readonly web_searches_per_minute?: number;
  readonly [key: string]: number | undefined;
}

export interface Model {
  id: string;
  name: string;
  created?: number;
  description?: string;
  context_length?: number;
  architecture?: ModelArchitecture;
  pricing?: ModelPricing;
  sats_pricing: ModelSatsPricing;
  per_request_limits?: PerRequestLimits;
}

/**
 * Result from spending cashu tokens
 */
export interface SpendResult {
  token: string | null;
  status: "success" | "failed";
  balance: number;
  unit?: "sat" | "msat";
  error?: string;
  errorDetails?: {
    required: number;
    available: number;
    maxMintBalance: number;
    maxMintUrl: string;
  };
}

/**
 * Result from refund operations
 */
export interface RefundResult {
  success: boolean;
  refundedAmount?: number;
  message?: string;
  requestId?: string;
}

/**
 * Result from top up operations
 */
export interface TopUpResult {
  success: boolean;
  toppedUpAmount?: number;
  message?: string;
  requestId?: string;
  recoveredToken?: boolean;
}

/**
 * API error verdict for retry logic
 */
export interface APIErrorVerdict {
  retry: boolean;
  reason: string;
  newBaseUrl?: string; // New provider to retry with (for 50X errors)
}

/**
 * Image data from API response
 */
export interface ImageData {
  type: "image_url";
  image_url: {
    url: string;
  };
  index?: number;
}

/**
 * Annotation data from API response
 */
export interface AnnotationData {
  type: "url_citation";
  start_index: number;
  end_index: number;
  url: string;
  title: string;
}

/**
 * Usage statistics from API response
 */
export interface UsageStats {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  sats_cost?: number;
}

/**
 * Result from streaming response processing
 */
export interface StreamingResult {
  content: string;
  thinking?: string;
  images?: ImageData[];
  usage?: UsageStats;
  model?: string;
  responseId?: string;
  finish_reason?: string;
  citations?: string[];
  annotations?: AnnotationData[];
}

/**
 * Parameters for fetching AI response
 */
export interface FetchAIResponseParams {
  messageHistory: Message[];
  selectedModel: Model;
  baseUrl: string;
  mintUrl: string;
  balance: number;
  transactionHistory: TransactionHistory[];
}

/**
 * Candidate provider for failover
 */
export interface CandidateProvider {
  baseUrl: string;
  model: Model;
  cost: number;
}

/**
 * Mint selection result
 */
export interface MintSelection {
  selectedMintUrl: string | null;
  selectedMintBalance: number;
}

/**
 * Pending token entry
 */
export interface PendingTokenEntry {
  baseUrl: string;
  amount: number;
}

/**
 * Provider information from /v1/info endpoint
 */
export interface ProviderInfo {
  mints?: string[];
  [key: string]: any;
}

/**
 * Model discovery result
 */
export interface ModelDiscoveryResult {
  models: Model[];
  bestById: Map<string, { model: Model; base: string }>;
  totalProcessed: number;
}

/**
 * Mint discovery result
 */
export interface MintDiscoveryResult {
  mintsFromProviders: Record<string, string[]>;
  infoFromProviders: Record<string, ProviderInfo>;
}
