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
