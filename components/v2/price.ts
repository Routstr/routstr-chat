import type { Model } from "@/types/models";

/* One estimate everywhere a price is shown before sending: the words so far
   (the conversation plus the draft) and a reply of ordinary length. It is
   shown with a tilde. The real charge is settled by the provider. */

const REPLY_TOKENS = 550;

export const promptTokens = (history: string, draft: string) => (history.length + draft.length) / 3.4 + 40;

export const estimateSats = (model: Model | undefined | null, tokens: number) => {
  const sp = model?.sats_pricing;
  if (!sp) return 0;
  const raw = (sp.prompt || 0) * tokens + (sp.completion || 0) * REPLY_TOKENS + (sp.request || 0);
  // the node settles each reply in whole sats, rounded up
  return raw > 0 ? Math.ceil(raw) : 0;
};
