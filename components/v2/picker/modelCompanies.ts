import {
  AwsIcon,
  BlackForestLabsIcon,
  ByteDanceIcon,
  ClaudeIcon,
  CohereIcon,
  DeepSeekIcon,
  GeminiIcon,
  GrokIcon,
  HunyuanIcon,
  IBMIcon,
  IdeogramIcon,
  InceptionIcon,
  InferenceIcon,
  KimiIcon,
  KreaIcon,
  LingIcon,
  LiquidIcon,
  LongCatIcon,
  LumaIcon,
  MetaIcon,
  MicrosoftIcon,
  MinimaxIcon,
  MistralIcon,
  MorphIcon,
  NvidiaIcon,
  OpenAIIcon,
  PerceptronIcon,
  PerplexityIcon,
  QwenIcon,
  RecraftIcon,
  RekaIcon,
  RelaceIcon,
  SakanaIcon,
  StepFunIcon,
  TypeSafeIcon,
  UpstageIcon,
  VeniceIcon,
  ZAIIcon,
} from "./companyIcons";
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
    keywords: ["zhipu", "glm", "chatglm"],
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
    keywords: [
      "google",
      "gemini",
      "gemma",
      "lyria",
      "nano-banana",
      "imagen",
      "veo",
    ],
  },
  {
    id: "alibaba",
    label: "Alibaba",
    shortLabel: "QW",
    keywords: ["alibaba", "qwen", "qwq", "wan", "z-image"],
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
    keywords: [
      "mistral",
      "mixtral",
      "codestral",
      "ministral",
      "magistral",
      "devstral",
      "pixtral",
      "voxtral",
    ],
  },
  {
    id: "meta",
    label: "Meta",
    shortLabel: "ME",
    keywords: ["meta", "llama", "facebook", "muse-spark"],
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
  {
    id: "bytedance",
    label: "ByteDance",
    shortLabel: "BD",
    keywords: ["bytedance", "seedream", "doubao", "ui-tars"],
  },
  {
    id: "bfl",
    label: "Black Forest Labs",
    shortLabel: "BF",
    keywords: ["black-forest", "black forest", "flux"],
  },
  {
    id: "tencent",
    label: "Tencent",
    shortLabel: "TC",
    keywords: ["tencent", "hunyuan"],
  },
  {
    id: "recraft",
    label: "Recraft",
    shortLabel: "RC",
    keywords: ["recraft"],
  },
  {
    id: "xiaomi",
    label: "Xiaomi",
    shortLabel: "XM",
    keywords: ["xiaomi", "mimo"],
  },
  {
    id: "sakana",
    label: "Sakana AI",
    shortLabel: "SK",
    keywords: ["sakana"],
  },
  {
    id: "inception",
    label: "Inception",
    shortLabel: "IN",
    keywords: ["inception", "mercury"],
  },
  {
    id: "krea",
    label: "Krea",
    shortLabel: "KR",
    keywords: ["krea"],
  },
  {
    id: "stepfun",
    label: "StepFun",
    shortLabel: "SF",
    keywords: ["stepfun"],
  },
  {
    id: "inclusionai",
    label: "inclusionAI",
    shortLabel: "IA",
    keywords: ["inclusionai"],
  },
  {
    id: "venice",
    label: "Venice",
    shortLabel: "VE",
    keywords: ["venice"],
  },
  {
    id: "aion",
    label: "Aion Labs",
    shortLabel: "AL",
    keywords: ["aionlabs", "aion-labs", "aion"],
  },
  {
    id: "liquid",
    label: "Liquid AI",
    shortLabel: "LQ",
    keywords: ["liquid", "lfm"],
  },
  {
    id: "reka",
    label: "Reka",
    shortLabel: "RK",
    keywords: ["reka"],
  },
  {
    id: "perceptron",
    label: "Perceptron",
    shortLabel: "PC",
    keywords: ["perceptron"],
  },
  {
    id: "morph",
    label: "Morph",
    shortLabel: "MO",
    keywords: ["morph"],
  },
  {
    id: "relace",
    label: "Relace",
    shortLabel: "RL",
    keywords: ["relace"],
  },
  {
    id: "luma",
    label: "Luma",
    shortLabel: "LU",
    keywords: ["luma"],
  },
  {
    id: "ideogram",
    label: "Ideogram",
    shortLabel: "ID",
    keywords: ["ideogram"],
  },
  {
    id: "thinkingmachines",
    label: "Thinking Machines",
    shortLabel: "TM",
    keywords: ["thinkingmachines", "thinking machines", "inkling"],
  },
  {
    id: "poolside",
    label: "Poolside",
    shortLabel: "PS",
    keywords: ["poolside", "laguna"],
  },
  {
    id: "upstage",
    label: "Upstage",
    shortLabel: "UP",
    keywords: ["upstage", "solar"],
  },
  {
    id: "inferencenet",
    label: "Inference.net",
    shortLabel: "IF",
    keywords: ["inference-net", "inference.net", "schematron"],
  },
  {
    id: "typesafe",
    label: "TypeSafe AI",
    shortLabel: "TS",
    keywords: ["typesafe", "jev"],
  },
  {
    id: "microsoft",
    label: "Microsoft",
    shortLabel: "MS",
    keywords: ["microsoft", "phi-", "wizardlm"],
  },
  {
    id: "ibm",
    label: "IBM",
    shortLabel: "IB",
    keywords: ["ibm", "granite"],
  },
  {
    id: "meituan",
    label: "Meituan",
    shortLabel: "MT",
    keywords: ["meituan", "longcat"],
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
  bytedance: ByteDanceIcon,
  bfl: BlackForestLabsIcon,
  tencent: HunyuanIcon,
  recraft: RecraftIcon,
  sakana: SakanaIcon,
  inception: InceptionIcon,
  krea: KreaIcon,
  stepfun: StepFunIcon,
  inclusionai: LingIcon,
  venice: VeniceIcon,
  liquid: LiquidIcon,
  reka: RekaIcon,
  perceptron: PerceptronIcon,
  morph: MorphIcon,
  relace: RelaceIcon,
  luma: LumaIcon,
  ideogram: IdeogramIcon,
  microsoft: MicrosoftIcon,
  ibm: IBMIcon,
  upstage: UpstageIcon,
  inferencenet: InferenceIcon,
  typesafe: TypeSafeIcon,
  meituan: LongCatIcon,
};

const companyIn = (text: string) => {
  const words = text.split(/[^a-z0-9]+/);
  // a short keyword starts a word: "o1" is not in "sao10k", nor "wan" in "swan"
  const has = (keyword: string) =>
    /^[a-z0-9]{1,4}$/.test(keyword)
      ? words.some((word) => word.startsWith(keyword))
      : text.includes(keyword);
  return MODEL_COMPANIES.find((company) => company.keywords.some(has))?.id;
};

export const getModelCompanyId = (model: Model): string =>
  companyIn(`${model.id} ${model.name}`.toLowerCase()) ?? "other";

export const getCompanyMeta = (id: string) =>
  MODEL_COMPANIES.find((company) => company.id === id) ?? {
    id: "other",
    label: "Other",
    shortLabel: "OT",
    keywords: [],
  };
