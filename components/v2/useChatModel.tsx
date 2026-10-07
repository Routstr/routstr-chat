import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { useCatalogModels, useCatalogService } from "@/features/catalog/view";
import { AcceptedMintsContext } from "@/features/wallet/view";
import type { Model } from "@/types/models";
import { getRequiredSatsForModel } from "@/utils/modelUtils";
import { defaultModel, pickedModel, useModelPick, type Choice } from "./pick";
import { normalizeModality } from "./picker/modality";
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

/** Works out the model once for every screen under it, and tells the wallet
 *  which mints the provider about to be paid takes, so new money lands where
 *  it can be spent. */
export function ChatModelProvider({ children }: { children: React.ReactNode }) {
  const value = useModelOf();
  const catalog = useCatalogService();
  // read when money comes in: the model and pin as they are then
  const now = useRef(value);
  useLayoutEffect(() => {
    now.current = value;
  });
  const accepted = useCallback(() => {
    const { model, chosen } = now.current;
    if (!model || !catalog) return [];
    const routes = catalog.routes(model.id);
    const base = chatModelOf(model, chosen, routes).provider ?? routes[0]?.baseUrl;
    return base ? catalog.mintsOf(base) : [];
  }, [catalog]);
  return (
    <ChatModelContext.Provider value={value}>
      <AcceptedMintsContext.Provider value={accepted}>{children}</AcceptedMintsContext.Provider>
    </ChatModelContext.Provider>
  );
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
  return { id: model.id, provider: pinned, images: inputs ? inputs.some((m) => normalizeModality(m) === "image") : undefined };
}
