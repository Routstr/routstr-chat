/* Development only. A full catalogue for the lab: 34 models, each served by
   one to four providers at their own prices, so the picker's every state can
   be seen without touching the real provider cache. */

import type { Model } from "@/types/models";
import type { Route } from "../picker/catalog";

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const HOSTS = ["https://api.routstr.com/", "https://api.nonkycai.com/", "https://privateprovider.xyz/", "https://relay.satsinfer.net/"];
const MODS: Record<string, string> = { t: "text", i: "image", a: "audio", f: "file" };

export const PICKS = [
  "anthropic/claude-sonnet-5", "openai/gpt-5", "google/gemini-3-pro", "deepseek/deepseek-v3.2", "moonshotai/kimi-k2",
  "qwen/qwen3-coder", "x-ai/grok-4-fast", "openai/gpt-image-2", "sonar-pro", "tinfoil/deepseek-r1-70b", "z-ai/glm-4.6",
  "meta-llama/llama-4-maverick",
];

// [id, name, days ago, context, inputs, outputs, $ per 1M in, $ per 1M out, providers [host, price factor], sats to start, description]
type RawRow = [string, string, number, number, string, string, number, number, [number, number][], number, string];
const RAW: RawRow[] = [
  ["anthropic/claude-opus-5", "Anthropic: Claude Opus 5", 12, 400000, "ti", "t", 15, 75, [[0, 1], [1, 1.12]], 2900, "Anthropic's largest model. Slow and careful, strongest on long agentic work, hard code and writing that has to be right the first time."],
  ["anthropic/claude-sonnet-5", "Anthropic: Claude Sonnet 5", 21, 400000, "tif", "t", 3, 15, [[0, 1], [1, 1.18], [3, 1.42]], 420, "A balanced model for everyday work: writing, code, analysis and reading long documents. Follows instructions closely and holds a long conversation well."],
  ["anthropic/claude-haiku-4.5", "Anthropic: Claude Haiku 4.5", 330, 200000, "ti", "t", 1, 5, [[0, 1], [3, 1.1]], 150, "Anthropic's fast, low cost model. Good for quick questions, summaries and short drafts."],
  ["gpt-5.5", "OpenAI: GPT-5.5", 9, 400000, "tif", "t", 5, 20, [[0, 1], [1, 1.06]], 640, "OpenAI's newest general model, with web search built in. Strong at reasoning, code and questions about current events."],
  ["openai/gpt-5", "OpenAI: GPT-5", 410, 400000, "ti", "t", 1.25, 10, [[0, 1], [1, 1.09], [2, 1.3]], 380, "OpenAI's flagship general model. Thinks before it answers when the question is hard, answers fast when it is not."],
  ["gpt-5.4-mini", "OpenAI: GPT-5.4 Mini", 60, 400000, "ti", "t", 0.4, 1.6, [[0, 1]], 70, "A smaller GPT-5.4 with web search. Quick and inexpensive for lookups and light writing."],
  ["gpt-5.4-nano", "OpenAI: GPT-5.4 Nano", 60, 400000, "t", "t", 0.1, 0.4, [[0, 1], [3, 1.2]], 20, "The smallest GPT-5.4. Very fast, very cheap, best for simple tasks and classification."],
  ["openai/gpt-image-2", "OpenAI: GPT Image 2", 35, 32000, "ti", "i", 5, 40, [[0, 1]], 900, "Makes and edits images from a description. Handles text inside images and follows detailed layout requests."],
  ["openai/gpt-oss-120b", "OpenAI: gpt-oss-120b", 420, 131000, "t", "t", 0.1, 0.5, [[1, 1], [0, 1.1], [3, 1.3], [2, 1.5]], 30, "OpenAI's open weight model. Runs on many providers, so it is cheap and rarely unavailable."],
  ["google/gemini-3-pro", "Google: Gemini 3 Pro", 50, 1000000, "tiaf", "t", 2, 12, [[0, 1], [1, 1.15]], 520, "Google's most capable model. Reads text, images, audio and PDFs, and can hold a very long document in mind at once."],
  ["google/gemini-3-flash", "Google: Gemini 3 Flash", 44, 1000000, "tiaf", "t", 0.3, 2.5, [[0, 1], [1, 1.2]], 90, "Google's fast model with the same very long context. A good default for large files on a budget."],
  ["google/gemini-2.5-flash-image", "Google: Gemini 2.5 Flash Image", 390, 32000, "ti", "ti", 0.3, 30, [[0, 1]], 700, "Makes and edits images in conversation, keeping characters and style consistent between turns."],
  ["google/gemma-3-27b", "Google: Gemma 3 27B", 560, 131000, "ti", "t", 0.09, 0.16, [[1, 1], [0, 1.2]], 12, "Google's open model. Small and inexpensive, good for simple tasks."],
  ["deepseek/deepseek-v3.2", "DeepSeek: DeepSeek V3.2", 70, 164000, "t", "t", 0.27, 0.4, [[1, 1], [0, 1.06], [3, 1.25], [2, 1.6]], 40, "DeepSeek's general model. Very low cost for its strength, especially at code and maths."],
  ["deepseek/deepseek-r1", "DeepSeek: R1", 250, 164000, "t", "t", 0.5, 2.2, [[1, 1], [0, 1.1]], 110, "A reasoning model that works through a problem step by step before answering."],
  ["tinfoil/deepseek-r1-70b", "DeepSeek: R1 70B (private)", 140, 64000, "t", "t", 0.75, 3, [[2, 1]], 140, "R1 distilled to 70B, running inside a sealed enclave. The provider cannot read your messages."],
  ["tinfoil/llama3-3-70b", "Meta: Llama 3.3 70B (private)", 300, 64000, "t", "t", 0.7, 2.8, [[2, 1]], 130, "Llama 3.3 running inside a sealed enclave. The provider cannot read your messages."],
  ["x-ai/grok-4", "xAI: Grok 4", 200, 256000, "ti", "t", 3, 15, [[0, 1]], 450, "xAI's flagship model, strong at reasoning and maths."],
  ["x-ai/grok-4-fast", "xAI: Grok 4 Fast", 120, 2000000, "ti", "t", 0.2, 0.5, [[0, 1], [1, 1.1]], 40, "A fast Grok with an unusually long context, at a very low price."],
  ["qwen/qwen3-coder", "Qwen: Qwen3 Coder", 160, 262000, "t", "t", 0.22, 0.95, [[1, 1], [0, 1.08], [3, 1.3]], 60, "Alibaba's coding model. Writes, reads and fixes code across large projects."],
  ["qwen/qwen3-235b", "Qwen: Qwen3 235B", 190, 262000, "t", "t", 0.18, 0.54, [[1, 1], [0, 1.1]], 40, "Alibaba's large general model, good at many languages."],
  ["qwen/qwen-image", "Qwen: Qwen Image", 100, 32000, "t", "i", 0, 20, [[0, 1]], 420, "Makes images from a description, and is good at text inside images."],
  ["moonshotai/kimi-k2", "MoonshotAI: Kimi K2", 80, 262000, "t", "t", 0.6, 2.5, [[1, 1], [0, 1.05], [3, 1.2]], 100, "Moonshot's large model, built for long tasks with many steps and tools."],
  ["z-ai/glm-4.6", "Z.AI: GLM 4.6", 95, 200000, "t", "t", 0.6, 2.2, [[1, 1], [0, 1.15]], 90, "Zhipu's general model, strong at code and agent work."],
  ["minimax/minimax-m2", "MiniMax: MiniMax M2", 88, 196000, "t", "t", 0.3, 1.2, [[1, 1]], 55, "A compact, efficient model for code and tool use."],
  ["mistralai/mistral-large-3", "Mistral: Mistral Large 3", 150, 128000, "ti", "t", 2, 6, [[0, 1]], 240, "Mistral's largest model, fluent in European languages."],
  ["mistralai/codestral", "Mistral: Codestral", 270, 256000, "t", "t", 0.3, 0.9, [[0, 1], [1, 1.1]], 45, "Mistral's model for code completion and editing."],
  ["meta-llama/llama-4-maverick", "Meta: Llama 4 Maverick", 520, 1000000, "ti", "t", 0.15, 0.6, [[1, 1], [0, 1.1], [3, 1.2]], 30, "Meta's open model with a very long context. Reads images too."],
  ["meta-llama/llama-4-scout", "Meta: Llama 4 Scout", 520, 1000000, "ti", "t", 0.08, 0.3, [[1, 1]], 18, "A smaller Llama 4, inexpensive, with the same long context."],
  ["sonar-pro", "Perplexity: Sonar Pro", 240, 200000, "t", "t", 3, 15, [[0, 1]], 460, "Searches the web as it answers and cites its sources."],
  ["sonar", "Perplexity: Sonar", 240, 128000, "t", "t", 1, 1, [[0, 1]], 60, "A quick answer engine that searches the web and cites sources."],
  ["cohere/command-a", "Cohere: Command A", 200, 256000, "t", "t", 2.5, 10, [[0, 1]], 330, "Cohere's model for business writing and search over documents."],
  ["nvidia/nemotron-nano-9b", "NVIDIA: Nemotron Nano 9B", 60, 128000, "t", "t", 0.04, 0.16, [[1, 1]], 8, "A tiny reasoning model. Very cheap for simple questions."],
  ["amazon/nova-pro", "Amazon: Nova Pro", 300, 300000, "tif", "t", 0.8, 3.2, [[0, 1]], 120, "Amazon's capable general model, reads images and documents."],
];

// one provider's listing of a model, priced so the app's own "sats to start"
// maths lands on the listed minimum
const listing = (r: RawRow, factor: number): Model => {
  const [id, name, ago, ctx, ins, outs, pin, pout, , min, description] = r;
  const prompt = (pin * 1000 * factor) / 1e6;
  const completion = (pout * 1000 * factor) / 1e6;
  const start = min * factor;
  return {
    id,
    name,
    created: NOW - ago * DAY,
    description,
    context_length: ctx,
    architecture: {
      modality: "text->text",
      input_modalities: [...ins].map((c) => MODS[c]),
      output_modalities: [...outs].map((c) => MODS[c]),
      tokenizer: "",
      instruct_type: null,
    },
    pricing: { prompt: 0, completion: 0, request: 0, image: 0, web_search: 0, internal_reasoning: 0 },
    sats_pricing: {
      prompt,
      completion,
      request: 0,
      image: 0,
      web_search: 0,
      internal_reasoning: 0,
      max_completion_cost: Math.max(0.01, start / 1.05 - prompt * 10000),
      max_prompt_cost: prompt * 10000,
      max_cost: start,
    },
    per_request_limits: null,
  } as unknown as Model;
};

const host = (base: string) => new URL(base).host;

const ROUTES = new Map<string, Route[]>(
  RAW.map((r) => {
    const cost = (m: Model) => m.sats_pricing.prompt + m.sats_pricing.completion;
    const routes = r[8]
      .map(([h, f]) => ({ base: HOSTS[h], host: host(HOSTS[h]), model: listing(r, f) }))
      .sort((a, b) => cost(a.model) - cost(b.model));
    return [r[0], routes];
  })
);

/** Each model as its cheapest provider lists it. */
export const LAB_MODELS: Model[] = RAW.map((r) => ROUTES.get(r[0])![0].model);
export const labRoutes = (id: string) => ROUTES.get(id) ?? [];
