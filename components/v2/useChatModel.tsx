import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { useCatalogModels, useCatalogService } from "@/features/catalog/view";
import { useKeyCredit } from "@/features/chat/view";
import { AcceptedMintsContext } from "@/features/wallet/view";
import type { Model } from "@/types/models";
import { defaultModel, pickedModel, useModelPick, type Choice } from "./pick";
import { needOf } from "./price";
import { payable, useMoney, usePayable, type Payable } from "./useMoney";

/** With nothing chosen: what the app picks for what can pay, a key's credit
 *  counted where each model's message would go. */
const autoPick = (models: Model[], catalog: ReturnType<typeof useCatalogService>, chosen: Choice | null, pay: Payable) =>
  defaultModel(models, catalog?.picks() ?? [], needOf, (m) =>
    // a model is ranked only when a key's credit decides it
    pay.covers(m, () => (catalog ? goesTo(m, chosen, catalog.routes(m.id)) : undefined))
  );

function useModelOf() {
  const catalog = useCatalogService();
  const { models, loading } = useCatalogModels();
  const pick = useModelPick();
  const pay = usePayable();
  const model = useMemo(
    () => pickedModel(models, pick) ?? autoPick(models, catalog, pick.chosen, pay),
    [models, pick, catalog, pay]
  );
  // ranked again whenever the catalogue changes (a cooldown keeps the same models), not on
  // every render of the composer
  const provider = useMemo(
    () => (model && catalog ? goesTo(model, pick.chosen, catalog.routes(model.id)) : undefined),
    [model, pick.chosen, catalog, models]
  );
  return { ...pick, models, loading, model, provider };
}

const ChatModelContext = createContext<ReturnType<typeof useModelOf> | null>(null);

/** Works out the model once for every screen under it, and tells the wallet
 *  which mints the provider about to be paid takes, so new money lands where
 *  it can be spent. */
export function ChatModelProvider({ children }: { children: React.ReactNode }) {
  const value = useModelOf();
  const catalog = useCatalogService();
  const { total, node } = useMoney();
  const credit = useKeyCredit();
  // read when money comes in: the model and pin as they are then
  const now = useRef({ value, total, credit, node });
  useLayoutEffect(() => {
    now.current = { value, total, credit, node };
  });
  const accepted = useCallback(
    (sats: number) => {
      const { value, total, credit, node } = now.current;
      if (!catalog) return [];
      // with nothing chosen, the model the app will pick once these sats are in
      const model = pickedModel(value.models, value) ?? autoPick(value.models, catalog, value.chosen, payable(total + sats, credit, !!node));
      if (!model) return [];
      const base = goesTo(model, value.chosen, catalog.routes(model.id));
      return base ? catalog.mintsOf(base) : [];
    },
    [catalog]
  );
  return (
    <ChatModelContext.Provider value={value}>
      <AcceptedMintsContext.Provider value={accepted}>{children}</AcceptedMintsContext.Provider>
    </ChatModelContext.Provider>
  );
}

/** The model you talk to: your pick (or a "?model=" link) as the catalogue has
 *  it now, else the one the app picks for what you can spend; the provider a
 *  message to it goes to. With the catalogue and the pick's own state. */
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

/** Where a message to this model goes: its pin while routing still serves it
 *  there, else the cheapest provider, as the SDK routes it. */
export function goesTo(model: Model, chosen: Choice | null, routes: { baseUrl: string }[]): string | undefined {
  return chatModelOf(model, chosen, routes).provider ?? routes[0]?.baseUrl;
}
