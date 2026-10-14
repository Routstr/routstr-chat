import type { Model } from "@/types/models";

/* One estimate everywhere a price is shown before sending: the words so far
   (the conversation plus the draft) and a reply of ordinary length, or one
   picture where the node prices picture tokens. It is shown with a tilde. The
   real charge is settled by the provider. */

const REPLY_TOKENS = 550;
// one picture, as Gemini counts its 1K pictures
const PICTURE_TOKENS = 1290;


export const promptTokens = (history: string, draft: string) => (history.length + draft.length) / 3.4 + 40;

/** `pictureRate`: the picture-token price another node lists for this model,
 *  for a node that lists none. */
export const estimateSats = (model: Model | undefined | null, tokens: number, pictureRate?: number) => {
  const sp = model?.sats_pricing;
  if (!sp) return 0;
  const picture = sp.image_output || pictureRate;
  const reply = picture ? picture * PICTURE_TOKENS : (sp.completion || 0) * REPLY_TOKENS;
  const raw = (sp.prompt || 0) * tokens + reply + (sp.request || 0);
  // the node settles each reply in whole sats, rounded up
  return raw > 0 ? Math.ceil(raw) : 0;
};
