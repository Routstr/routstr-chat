import {
  AwsIcon,
  ClaudeIcon,
  CohereIcon,
  DeepSeekIcon,
  GeminiIcon,
  GrokIcon,
  KimiIcon,
  MetaIcon,
  MinimaxIcon,
  MistralIcon,
  NvidiaIcon,
  OpenAIIcon,
  PerplexityIcon,
  QwenIcon,
  ZAIIcon,
} from "@/components/icons/companyIcons";
import { Model } from "@/types/models";

type ModelCompanyDefinition = {
  id: string;
  label: string;
  shortLabel: string;
  keywords: string[];
};

// Order is deliberate: it sets the company rail order (roughly by how much
// the network actually uses each lab) and doubles as keyword-match priority
// in getModelCompanyId.
export const MODEL_COMPANIES: ModelCompanyDefinition[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    shortLabel: "AN",
    keywords: ["anthropic", "claude"],
  },
  {
    id: "openai",
    label: "OpenAI",
    shortLabel: "OA",
    keywords: ["openai", "gpt", "chatgpt", "o1", "o3", "o4"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    shortLabel: "DS",
    keywords: ["deepseek"],
  },
  {
    id: "zhipu",
    label: "Zhipu AI",
    shortLabel: "GL",
    keywords: ["zhipu", "glm"],
  },
  {
    id: "moonshot",
    label: "Moonshot",
    shortLabel: "KI",
    keywords: ["moonshot", "kimi"],
  },
  {
    id: "minimax",
    label: "MiniMax",
    shortLabel: "MM",
    keywords: ["minimax"],
  },
  {
    id: "google",
    label: "Google",
    shortLabel: "GO",
    keywords: ["google", "gemini", "gemma"],
  },
  {
    id: "alibaba",
    label: "Alibaba",
    shortLabel: "QW",
    keywords: ["alibaba", "qwen", "qwq", "wan"],
  },
  {
    id: "xai",
    label: "xAI",
    shortLabel: "xA",
    keywords: ["xai", "grok"],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    shortLabel: "PX",
    keywords: ["perplexity", "sonar", "pplx"],
  },
  {
    id: "mistral",
    label: "Mistral",
    shortLabel: "MI",
    keywords: ["mistral", "mixtral", "codestral", "ministral"],
  },
  {
    id: "meta",
    label: "Meta",
    shortLabel: "ME",
    keywords: ["meta", "llama"],
  },
  {
    id: "cohere",
    label: "Cohere",
    shortLabel: "CO",
    keywords: ["cohere", "command"],
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    shortLabel: "NV",
    keywords: ["nvidia", "nemotron"],
  },
  {
    id: "amazon",
    label: "Amazon",
    shortLabel: "AZ",
    keywords: ["amazon", "nova"],
  },
];

type CompanyIconComponent = typeof OpenAIIcon;

export const COMPANY_ICON_COMPONENTS: Partial<
  Record<string, CompanyIconComponent>
> = {
  openai: OpenAIIcon,
  anthropic: ClaudeIcon,
  google: GeminiIcon,
  deepseek: DeepSeekIcon,
  xai: GrokIcon,
  perplexity: PerplexityIcon,
  alibaba: QwenIcon,
  moonshot: KimiIcon,
  mistral: MistralIcon,
  meta: MetaIcon,
  minimax: MinimaxIcon,
  zhipu: ZAIIcon,
  cohere: CohereIcon,
  nvidia: NvidiaIcon,
  amazon: AwsIcon,
};

export const getModelCompanyId = (model: Model): string => {
  const haystack = `${model.id} ${model.name}`.toLowerCase();
  return (
    MODEL_COMPANIES.find((company) =>
      company.keywords.some((keyword) => haystack.includes(keyword))
    )?.id ?? "other"
  );
};

export const getCompanyMeta = (id: string) =>
  MODEL_COMPANIES.find((company) => company.id === id) ?? {
    id: "other",
    label: "Other",
    shortLabel: "OT",
    keywords: [],
  };
