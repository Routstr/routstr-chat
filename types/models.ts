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
  created: number;
  description: string;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: readonly string[];
    output_modalities: readonly string[];
    tokenizer: string;
    instruct_type: string | null;
  };
  pricing: {
    prompt: number;
    completion: number;
    request: number;
    image: number;
    web_search: number;
    internal_reasoning: number;
  };
  sats_pricing: {
    prompt: number;
    completion: number;
    request: number;
    image: number;
    /** A picture token a model draws; newer nodes list it. */
    image_output?: number;
    web_search: number;
    internal_reasoning: number;
    max_completion_cost: number;
    max_prompt_cost: number;
    max_cost: number;
  };
  per_request_limits: PerRequestLimits;
  top_provider?: { context_length?: number; max_completion_tokens?: number | null };
  /** A picture model's price steps in USD; sats_pricing.image_output is the dearest in sats. */
  image_pricing?: {
    max_usd: number;
    tiers: readonly { resolution: string | null; quality: string | null; usd: number }[];
    resolutions: readonly string[];
    qualities: readonly string[];
    default_resolution: string | null;
    default_quality: string | null;
    unit?: string;
    megapixel_usd?: number;
    endpoints?: Readonly<Record<string, { parameters?: { n?: { max?: number } } }>>;
  };
}

export interface RoutstrNodeInfo {
  name: string;
  description: string;
  version: string;
  npub: string;
  mint: string;
  http_url: string;
  onion_url: string;
  models: Model[];
}
