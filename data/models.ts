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

// Initial state with empty data
export let models: Model[] = [];
export let nodeInfo: Partial<RoutstrNodeInfo> = {
  name: "Routstr Node",
  description: "A Routstr Node",
  version: "0.0.1"
};

// Fetch models from the API
export async function fetchModels(): Promise<void> {
  try {
    const response = await fetch('https://api.routstr.com/');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    
    const data: RoutstrNodeInfo = await response.json();
    
    // Update the models and node info
    models = data.models;
    nodeInfo = data;
    
    return;
  } catch (error) {
    console.error('Error fetching models:', error);
    return;
  }
}

// Extract the provider name from the model name (e.g., "Qwen" from "Qwen: Qwen3 30B A3B")
export function getProviderFromModelName(modelName: string): string {
  const colonIndex = modelName.indexOf(':');
  if (colonIndex !== -1) {
    return modelName.substring(0, colonIndex).trim();
  }
  return 'Unknown';
}

// Extract the model name without provider (e.g., "Qwen3 30B A3B" from "Qwen: Qwen3 30B A3B")
export function getModelNameWithoutProvider(modelName: string): string {
  const colonIndex = modelName.indexOf(':');
  if (colonIndex !== -1) {
    return modelName.substring(colonIndex + 1).trim();
  }
  return modelName;
}

// Format price as a string
export function formatPrice(model: Model): string {
  const promptPrice = model.pricing.prompt.toExponential(6);
  const completionPrice = model.pricing.completion.toExponential(6);
  
  return `$${promptPrice} prompt / $${completionPrice} completion`;
}

// Format sats price as a string
export function formatSatsPrice(model: Model): string {
  const promptPrice = model.sats_pricing.prompt.toFixed(8);
  const completionPrice = model.sats_pricing.completion.toFixed(8);
  
  return `${promptPrice} sats/token prompt / ${completionPrice} sats/token completion`;
}

// Group models by provider
export function groupModelsByProvider(): Record<string, Model[]> {
  const grouped: Record<string, Model[]> = {};
  
  models.forEach(model => {
    const provider = getProviderFromModelName(model.name);
    if (!grouped[provider]) {
      grouped[provider] = [];
    }
    grouped[provider].push(model);
  });
  
  return grouped;
}

// Get popular models (for showcase)
export function getPopularModels(count: number = 6): Model[] {
  // Sort by created date (newest first) and return top N
  return [...models]
    .sort((a, b) => 
      // Prioritize newest models
      b.created - a.created
    )
    .slice(0, count);
}

// Get a model id for example usage
export function getExampleModelId(): string {
  // Find a model from a well-known provider for examples
  const candidates = models.filter(model => 
    model.name.toLowerCase().includes('qwen') || 
    model.name.toLowerCase().includes('gemini') || 
    model.name.toLowerCase().includes('glm')
  );
  
  if (candidates.length > 0) {
    return candidates[0].id;
  }
  
  // Fallback to first model if no good candidates
  return models.length > 0 ? models[0].id : "qwen/qwen3-14b";
} 