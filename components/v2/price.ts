import type { Model } from "@/types/models";

/* One estimate everywhere a price is shown before sending: the words so far
   (the conversation plus the draft) and a reply of ordinary length. It is
   shown with a tilde. The real charge is settled by the provider. */

const REPLY_TOKENS = 550;

export const promptTokens = (history: string, draft: string) => (history.length + draft.length) / 3.4 + 40;

/** What one message may take before it is sent, as main reckons it: room for
 *  10,000 prompt tokens and the longest reply, 5% over, or the model's
 *  `max_cost` when it names no longest reply. 0 when its price is unknown. */
export const needOf = (model: Model) => {
  const sp = model.sats_pricing;
  if (!sp) return 0;
  if (!sp.max_completion_cost) return sp.max_cost ?? 50;
  return ((sp.prompt || 0) * 10_000 + sp.max_completion_cost) * 1.05 || 0;
};

export const estimateSats = (model: Model | undefined | null, tokens: number) => {
  const sp = model?.sats_pricing;
  if (!sp) return 0;
  const raw = (sp.prompt || 0) * tokens + (sp.completion || 0) * REPLY_TOKENS + (sp.request || 0);
  // the node settles each reply in whole sats, rounded up
  return raw > 0 ? Math.ceil(raw) : 0;
};
