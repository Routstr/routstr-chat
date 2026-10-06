import React, { createContext, useContext, useMemo } from "react";
import { useCatalogModels, useCatalogService } from "@/features/catalog/view";
import type { Model } from "@/types/models";
import { getRequiredSatsForModel } from "@/utils/modelUtils";
import { defaultModel, pickedModel, useModelPick, type Choice } from "./pick";
import { useMoney } from "./useMoney";

const need = (m: Model) => getRequiredSatsForModel(m);

function useModelOf() {
  const catalog = useCatalogService();
  const { models, loading } = useCatalogModels();
  const pick = useModelPick();
  const { total } = useMoney();
  const model = useMemo(
    () =>
      pickedModel(models, pick) ??
      defaultModel(models, catalog?.picks() ?? [], total, need),
    [models, pick, catalog, total]
  );
  return { ...pick, models, loading, model };
}

const ChatModelContext = createContext<ReturnType<typeof useModelOf> | null>(null);

/** Works out the model once for every screen under it. */
export function ChatModelProvider({ children }: { children: React.ReactNode }) {
  return <ChatModelContext.Provider value={useModelOf()}>{children}</ChatModelContext.Provider>;
}

/** The model you talk to: your pick (or a "?model=" link) as the catalogue has
 *  it now, else the one the app picks for what you can spend. With the
 *  catalogue and the pick's own state. */
export function useChatModel() {
  const value = useContext(ChatModelContext);
  if (!value) throw new Error("useChatModel must be used inside ChatModelProvider");
  return value;
}

/** What the chat engine is told about a model: the pin, while the catalogue
 *  still routes this model to it, and whether it reads images. */
export function chatModelOf(
  model: Model,
  chosen: Choice | null,
  routes: { baseUrl: string }[]
): { id: string; provider?: string; images?: boolean } {
  // a pin is kept as main keys it: with a scheme and a closing slash
  const asKept = (url: string) => (url.endsWith("/") ? url : `${url}/`);
  const pinned =
    chosen?.id === model.id && chosen.provider
      ? routes.find((r) => asKept(r.baseUrl) === chosen.provider)?.baseUrl
      : undefined;
  const inputs = model.architecture?.input_modalities;
  // unknown inputs are not taken as text only
  return { id: model.id, provider: pinned, images: inputs ? inputs.includes("image") : undefined };
}
