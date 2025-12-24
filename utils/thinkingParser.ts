interface ThinkingContent {
  thinking: string;
  content: string;
}

interface ParsedThinking {
  hasThinking: boolean;
  thinking?: string;
  content: string;
}

export const parseThinkingContent = (
  rawContent: string,
  modelId?: string
): ParsedThinking => {
  const provider = modelId ? getProviderFromModel(modelId) : "unknown";
  const patterns = getThinkingPatternsForProvider(provider);

  for (const pattern of patterns) {
    const match = rawContent.match(pattern);
    if (match) {
      const thinking = match[1].trim();
      const content = rawContent.replace(pattern, "").trim();

      if (thinking && thinking.length > 0) {
        return {
          hasThinking: true,
          thinking,
          content: content || rawContent,
        };
      }
    }
  }

  return {
    hasThinking: false,
    content: rawContent,
  };
};

export const extractThinkingFromStream = (
  chunk: string,
  accumulatedThinking: string = ""
): {
  thinking: string;
  content: string;
  isInThinking: boolean;
} => {
  const thinkingStart = /<(?:antml:)?thinking>/;
  const thinkingEnd = /<\/(?:antml:)?thinking>/;

  let thinking = accumulatedThinking;
  let content = "";
  let isInThinking =
    accumulatedThinking.length > 0 &&
    !accumulatedThinking.includes("</thinking>");

  if (isInThinking) {
    const endMatch = chunk.match(thinkingEnd);
    if (endMatch) {
      const endIndex = chunk.indexOf(endMatch[0]);
      thinking += chunk.slice(0, endIndex);
      content = chunk.slice(endIndex + endMatch[0].length);
      isInThinking = false;
    } else {
      thinking += chunk;
    }
  } else {
    const startMatch = chunk.match(thinkingStart);
    if (startMatch) {
      const startIndex = chunk.indexOf(startMatch[0]);
      content = chunk.slice(0, startIndex);

      const remainingChunk = chunk.slice(startIndex + startMatch[0].length);
      const endMatch = remainingChunk.match(thinkingEnd);

      if (endMatch) {
        const endIndex = remainingChunk.indexOf(endMatch[0]);
        thinking = remainingChunk.slice(0, endIndex);
        content += remainingChunk.slice(endIndex + endMatch[0].length);
        isInThinking = false;
      } else {
        thinking = remainingChunk;
        isInThinking = true;
      }
    } else {
      content = chunk;
    }
  }

  return { thinking, content, isInThinking };
};

const THINKING_CAPABLE_PATTERNS = [
  /claude-3(\.[5-9])?-sonnet/i,
  /claude-3-opus/i,
  /claude-3-haiku/i,
  /sonnet-4/i,
  /opus-4/i,
  /o1(-preview|-mini)?/i,
  /gpt-4o.*thinking/i,
];

const PROVIDER_THINKING_FORMATS = {
  anthropic: [
    /<(?:antml:)?thinking>([\s\S]*?)<\/(?:antml:)?thinking>/,
    /\[THINKING\]([\s\S]*?)\[\/THINKING\]/,
  ],
  openai: [
    /<thinking>([\s\S]*?)<\/thinking>/,
    /^([\s\S]*?)\n\n---\n\n([\s\S]*)$/m,
  ],
};

export const isThinkingCapableModel = (modelId: string): boolean => {
  return THINKING_CAPABLE_PATTERNS.some((pattern) => pattern.test(modelId));
};

export const getProviderFromModel = (modelId: string): string => {
  if (/claude|sonnet|opus|haiku/i.test(modelId)) return "anthropic";
  if (/o1|gpt/i.test(modelId)) return "openai";
  return "unknown";
};

export const getThinkingPatternsForProvider = (provider: string): RegExp[] => {
  return (
    PROVIDER_THINKING_FORMATS[
      provider as keyof typeof PROVIDER_THINKING_FORMATS
    ] || PROVIDER_THINKING_FORMATS.anthropic
  );
};
