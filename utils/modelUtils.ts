export function parseModelKey(key: string): {
  id: string;
  base: string | null;
} {
  const separatorIndex = key.indexOf("@@");
  if (separatorIndex === -1) {
    return { id: key, base: null };
  }
  return {
    id: key.slice(0, separatorIndex),
    base: key.slice(separatorIndex + 2),
  };
}

export function normalizeBaseUrl(base?: string | null): string | null {
  if (!base || typeof base !== "string" || base.length === 0) return null;
  const withProto = base.startsWith("http") ? base : `https://${base}`;
  return withProto.endsWith("/") ? withProto : `${withProto}/`;
}

// Provider models cache helpers shared across app
// Kept here to avoid duplicating localStorage logic in components
import type { Model } from "@/types/models";
import { recommendedModels } from "@/lib/preconfiguredModels";
import {
  getStorageItem,
  loadLastUsedModel,
  setStorageItem,
} from "@/utils/storageUtils";

// Extract the provider name from the model name (e.g., "Qwen" from "Qwen: Qwen3 30B A3B")
export function getProviderFromModelName(modelName: string): string {
  const colonIndex = modelName.indexOf(":");
  if (colonIndex !== -1) {
    return modelName.substring(0, colonIndex).trim();
  }
  return "Unknown";
}

// Extract the model name without provider (e.g., "Qwen3 30B A3B" from "Qwen: Qwen3 30B A3B")
export function getModelNameWithoutProvider(modelName: string): string {
  const colonIndex = modelName.indexOf(":");
  if (colonIndex !== -1) {
    return modelName.substring(colonIndex + 1).trim();
  }
  return modelName;
}

export function upsertCachedProviderModels(
  baseUrl: string,
  models: Model[],
): void {
  try {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return;
    const existing = getStorageItem<Record<string, Model[]>>(
      "modelsFromAllProviders",
      {} as any,
    );
    setStorageItem("modelsFromAllProviders", {
      ...existing,
      [normalized]: models,
    });
  } catch {}
}

export function getCachedProviderModels(baseUrl: string): Model[] | undefined {
  try {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return undefined;
    const all = getStorageItem<Record<string, Model[]>>(
      "modelsFromAllProviders",
      {} as any,
    );
    return all[normalized];
  } catch {
    return undefined;
  }
}
/**
 * Get a specific model object for a given provider base URL.
 * - Checks local storage cache first
 * - Falls back to fetching from `${baseUrl}/v1/models`
 * - Caches fetched list for future lookups
 */
export async function getModelForBase(
  baseUrl: string,
  modelId: string,
): Promise<Model | null> {
  try {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return null;

    // 1) Try cached models
    const cached =
      getCachedProviderModels(normalized) ??
      getCachedProviderModels(baseUrl) ??
      [];
    if (Array.isArray(cached) && cached.length > 0) {
      const hit = cached.find((m: Model) => m.id === modelId) ?? null;
      if (hit) return hit;
    }

    // 2) Fetch from provider and cache
    const res = await fetch(`${normalized}v1/models`);
    if (!res.ok) return null;

    const json = await res.json();
    const providerList: Model[] = Array.isArray(json?.data)
      ? json.data.map((m: Model) => ({
          ...m,
          id: m.id.split("/").pop() || m.id,
        }))
      : [];

    // Cache provider models for this base
    upsertCachedProviderModels(normalized, providerList);

    // Return matched model (using short id)
    return providerList.find((m: Model) => m.id === modelId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract image resolution (width, height) from a base64 data URL without DOM.
 * Supports PNG and JPEG. Returns null if format unsupported or parsing fails.
 */
function getImageResolutionFromDataUrl(
  dataUrl: string,
): { width: number; height: number } | null {
  try {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:"))
      return null;

    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) return null;

    const meta = dataUrl.slice(5, commaIdx); // e.g. "image/png;base64"
    const base64 = dataUrl.slice(commaIdx + 1);

    // Decode base64 to binary
    const binary =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("binary");

    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);

    const isPNG = meta.includes("image/png");
    const isJPEG = meta.includes("image/jpeg") || meta.includes("image/jpg");

    // PNG: width/height are 4-byte big-endian at offsets 16 and 20
    if (isPNG) {
      // Validate PNG signature
      const sig = [137, 80, 78, 71, 13, 10, 26, 10];
      for (let i = 0; i < sig.length; i++) {
        if (bytes[i] !== sig[i]) return null;
      }
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    // JPEG: parse markers to SOF0/SOF2 for dimensions
    if (isJPEG) {
      let offset = 0;
      // JPEG SOI 0xFFD8
      if (bytes[offset++] !== 0xff || bytes[offset++] !== 0xd8) return null;

      while (offset < bytes.length) {
        // Find marker
        while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
        if (offset + 1 >= bytes.length) break;

        // Skip fill bytes 0xFF
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];

        // Standalone markers without length
        if (marker === 0xd8 || marker === 0xd9) continue; // SOI/EOI

        if (offset + 1 >= bytes.length) break;
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;

        // SOF0 (0xC0) or SOF2 (0xC2) contain dimensions
        if (marker === 0xc0 || marker === 0xc2) {
          if (length < 7 || offset + length - 2 > bytes.length) return null;
          const precision = bytes[offset];
          const height = (bytes[offset + 1] << 8) | bytes[offset + 2];
          const width = (bytes[offset + 3] << 8) | bytes[offset + 4];
          if (precision > 0 && width > 0 && height > 0)
            return { width, height };
          return null;
        } else {
          // Skip this segment
          offset += length - 2;
        }
      }
      return null;
    }

    // Unsupported formats (e.g., webp/gif) - skip for now
    return null;
  } catch {
    return null;
  }
}

/**
 * Calculate image tokens based on OpenAI's vision pricing.
 *
 * For low detail: 85 tokens
 * For high detail/auto: 85 base tokens + 170 tokens per 512px tile
 */
export function calculateImageTokens(
  width: number,
  height: number,
  detail: "low" | "high" | "auto" = "auto",
): number {
  if (detail === "low") return 85;

  let w = width;
  let h = height;

  // Clamp longest side to 2048 while preserving aspect ratio
  if (w > 2048 || h > 2048) {
    const aspectRatio = w / h;
    if (w > h) {
      w = 2048;
      h = Math.floor(w / aspectRatio);
    } else {
      h = 2048;
      w = Math.floor(h * aspectRatio);
    }
  }

  // Then clamp longest side to 768 while preserving aspect ratio
  if (w > 768 || h > 768) {
    const aspectRatio = w / h;
    if (w > h) {
      w = 768;
      h = Math.floor(w / aspectRatio);
    } else {
      h = 768;
      w = Math.floor(h * aspectRatio);
    }
  }

  // Number of 512px tiles, ceil division using (x + 511) // 512
  const tilesWidth = Math.floor((w + 511) / 512);
  const tilesHeight = Math.floor((h + 511) / 512);
  const numTiles = tilesWidth * tilesHeight;

  return 85 + 170 * numTiles;
}

// Determine required minimum sats to run a request for a model
export const getRequiredSatsForModel = (
  model: Model,
  apiMessages?: any[],
): number => {
  try {
    let imageTokens = 0;
    if (apiMessages) {
      for (const msg of apiMessages as any[]) {
        const content = (msg as any)?.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            const isImage =
              part && typeof part === "object" && part.type === "image_url";
            const url: string | undefined = isImage
              ? typeof part.image_url === "string"
                ? part.image_url
                : part.image_url?.url
              : undefined;

            // Expecting a base64 data URL for local image inputs
            if (url && typeof url === "string" && url.startsWith("data:")) {
              const res = getImageResolutionFromDataUrl(url);
              if (res) {
                const tokensFromImage = calculateImageTokens(
                  res.width,
                  res.height,
                );
                // const patchSize = 32;
                // const patchesW = Math.floor((res.width + patchSize - 1) / patchSize);
                // const patchesH = Math.floor((res.height + patchSize - 1) / patchSize);
                // const tokensFromImage = patchesW * patchesH;
                imageTokens += tokensFromImage;
                console.log("IMAGE INPUT RESOLUTION", {
                  width: res.width,
                  height: res.height,
                  tokensFromImage,
                });
              } else {
                console.log(
                  "IMAGE INPUT RESOLUTION",
                  "unknown (unsupported format or parse failure)",
                );
              }
            }
          }
        }
      }
    }
    // Remove image_url parts from apiMessages when estimating text token count
    const apiMessagesNoImages = apiMessages // SWITCH AFTER NODE UPDAATES
      ? (apiMessages as any[]).map((m: any) => {
          if (Array.isArray(m?.content)) {
            const filtered = m.content.filter(
              (p: any) =>
                !(p && typeof p === "object" && p.type === "image_url"),
            );
            return { ...m, content: filtered };
          }
          return m;
        })
      : undefined;

    const approximateTokens = apiMessagesNoImages // SWITCH AFTER NODE UPDAATES
      ? Math.ceil(JSON.stringify(apiMessagesNoImages, null, 2).length / 2.84)
      : 10000; // Assumed tokens for minimum balance calculation

    const totalInputTokens = approximateTokens + imageTokens;

    if (apiMessages) {
      console.log("OUR TOKENS (TEXT-ONLY)", approximateTokens);
      console.log(
        "IMAGE TOKENS",
        imageTokens,
        "TOTAL INPUT TOKENS",
        totalInputTokens,
      );
    }
    const sp: any = model?.sats_pricing as any;

    if (!sp) return 0;

    // If we don't have max_completion_cost, fall back to max_cost
    if (!sp.max_completion_cost) {
      return sp.max_cost ?? 50;
    }

    // Calculate based on token usage (similar to getTokenAmountForModel in apiUtils.ts)
    const promptCosts = (sp.prompt || 0) * totalInputTokens;
    const totalEstimatedCosts = (promptCosts + sp.max_completion_cost) * 1.05;
    // return totalEstimatedCosts > sp.max_cost ? sp.max_cost : totalEstimatedCosts; // in some image input calculations, this cost balloons up. Now includes image tokens via 32px patches.
    return totalEstimatedCosts; // Backend has a bug here.it's calculating image tokens wrong. gotta switch to different logic once its fixed
  } catch (e) {
    console.error(e);
    return 0;
  }
};

// Check if a model is available based on balance
export const isModelAvailable = (model: Model, balance: number) => {
  try {
    const required = getRequiredSatsForModel(model);
    if (!required || required <= 0) return true;
    return balance >= required;
  } catch (error) {
    console.log(model);
    console.error(error);
    return true;
  }
};

export const modelSelectionStrategy = async (
  models: Model[],
  maxBalance: number,
  pendingCashuAmountState: number,
): Promise<Model | null> => {
  let modelToSelect: Model | null = null;
  const lastUsedModelId = loadLastUsedModel();
  if (!modelToSelect) {
    if (lastUsedModelId && lastUsedModelId.includes("@@")) {
      const { id, base } = parseModelKey(lastUsedModelId);
      const fixedBase = normalizeBaseUrl(base);
      if (!fixedBase) return null;
      const normalized = fixedBase.endsWith("/") ? fixedBase : `${fixedBase}/`;
      const allByProvider = getStorageItem<Record<string, Model[]>>(
        "modelsFromAllProviders",
        {} as any,
      );
      const list =
        allByProvider?.[normalized] || allByProvider?.[lastUsedModelId] || [];
      modelToSelect = Array.isArray(list)
        ? (list.find((m: Model) => m.id === id) ?? null)
        : null;
      if (!modelToSelect) {
        const res = await fetch(`${normalized}v1/models`);
        if (res.ok) {
          const json = await res.json();
          const providerList: Model[] = Array.isArray(json?.data)
            ? json.data.map((m: Model) => ({
                ...m,
                id: m.id.split("/").pop() || m.id,
              }))
            : [];
          const transformedId = id.split("/").pop() || id;
          const found =
            providerList.find((m: Model) => m.id === transformedId) ?? null;
          console.log("SMG", providerList);
          if (found) {
            // cache to storage for future
            upsertCachedProviderModels(normalized, providerList);
            modelToSelect = found;
          }
        }
      }
    } else if (lastUsedModelId) {
      modelToSelect =
        models.find((m: Model) => m.id === lastUsedModelId) ?? null;
    }
  }

  if (!modelToSelect) {
    const recommended = models
      .filter((m: Model) => recommendedModels.includes(m.id))
      .sort(
        (a, b) =>
          recommendedModels.indexOf(a.id) - recommendedModels.indexOf(b.id),
      );
    const compatible = recommended.filter((m: Model) =>
      isModelAvailable(m, maxBalance + pendingCashuAmountState),
    );
    if (compatible.length > 0) modelToSelect = compatible[0];
  }

  if (!modelToSelect) {
    const compatible = models
      .filter((m: Model) =>
        isModelAvailable(m, maxBalance + pendingCashuAmountState),
      )
      .sort((a, b) => {
        const aMaxCost = getRequiredSatsForModel(a);
        const bMaxCost = getRequiredSatsForModel(b);
        return bMaxCost - aMaxCost; // Descending order
      });
    if (compatible.length > 0) modelToSelect = compatible[0];
  }

  return modelToSelect;
};
