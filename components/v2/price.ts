import type { Model } from "@/types/models";
import type { PictureChoice } from "@/features/chat/view";
import { paints } from "./picker/catalog";

/* One estimate everywhere a price is shown before sending: the words so far
   (the conversation plus the draft) and a reply of ordinary length, or one
   picture where the node prices picture tokens. It is shown with a tilde. The
   real charge is settled by the provider. */

const REPLY_TOKENS = 550;
// one picture, as Gemini counts its 1K pictures
const PICTURE_TOKENS = 1290;


export const promptTokens = (history: string, draft: string) => (history.length + draft.length) / 3.4 + 40;

// a picture's megapixels at each size, as the SDK counts them
const MEGAPIXELS: Record<string, number> = { "512": 0.25, "1K": 1, "2K": 4, "4K": 16 };

/** What one picture costs at this size and quality, by the SDK's rule for
 *  what it holds for one; the dearest step where the model lists none. */
export const pictureSats = (model: Model, choice: Partial<PictureChoice> = {}) => {
  const top = model.sats_pricing?.image_output ?? 0;
  const ip = model.image_pricing;
  if (!ip?.max_usd) return Math.ceil(top);
  const perUsd = top / ip.max_usd;
  const resolution = choice.resolution?.toUpperCase();
  if (ip.unit === "megapixel" && ip.megapixel_usd) {
    return Math.ceil(perUsd * (MEGAPIXELS[resolution ?? "1K"] ?? 1) * ip.megapixel_usd);
  }
  const wanted = resolution ?? ip.default_resolution ?? null;
  for (const quality of [choice.quality?.toLowerCase() ?? ip.default_quality ?? null, null]) {
    const step = ip.tiers.find((t) => (t.resolution ?? null) === wanted && (t.quality ?? null) === quality);
    if (step) return Math.ceil(perUsd * step.usd);
  }
  return Math.ceil(top);
};

/** `pictureRate`: the picture-token price another node lists for this model,
 *  for a node that lists none. */
export const estimateSats = (model: Model | undefined | null, tokens: number, pictureRate?: number) => {
  const sp = model?.sats_pricing;
  if (!sp) return 0;
  if (paints(model)) return pictureSats(model);
  const picture = sp.image_output || pictureRate;
  const reply = picture ? picture * PICTURE_TOKENS : (sp.completion || 0) * REPLY_TOKENS;
  const raw = (sp.prompt || 0) * tokens + reply + (sp.request || 0);
  // the node settles each reply in whole sats, rounded up
  return raw > 0 ? Math.ceil(raw) : 0;
};
