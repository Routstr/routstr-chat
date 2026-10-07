import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCatalogModels, useCatalogService } from "@/features/catalog/view";
import { useKeyCredit } from "@/features/chat/view";
import { AcceptedMintsContext, usePurse } from "@/features/wallet/view";
import type { Model } from "@/types/models";
import { defaultModel, pickedModel, useModelPick, type Choice } from "./pick";
import { normalizeModality } from "./picker/modality";
import { needOf } from "./price";
import { payable, useMoney, usePayable, type Payable } from "./useMoney";

type Catalog = ReturnType<typeof useCatalogService>;
/** Where the SDK sends each asked model from this wallet, by its own rule. */
type Routed = Readonly<Record<string, string>>;
/** Those answers, and what they were asked with: the SDK's rule reads only
 *  which mints hold sats, the active mint, and the catalogue. */
interface Asked {
  of: string;
  catalog: unknown;
  at: Readonly<Record<string, string | null>>;
}

/** With nothing chosen: what the app picks for what can pay, a key's credit
 *  counted where each model's message would go. */
const autoPick = (models: Model[], catalog: Catalog, chosen: Choice | null, pay: Payable, routed: Routed) =>
  defaultModel(models, catalog?.picks() ?? [], needOf, (m) =>
    // a model is ranked only when a key's credit decides it
    pay.covers(m, () => (catalog ? goesTo(m, chosen, catalog.routes(m.id), routed[m.id]) : undefined))
  );


function useModelOf() {
  const catalog = useCatalogService();
  const { models, loading } = useCatalogModels();
  const pick = useModelPick();
  const pay = usePayable();
  const { balances } = useMoney();
  const purse = usePurse();
  const [answers, setAnswers] = useState<Asked>({ of: "", catalog: null, at: {} });
  const activeMint = purse()?.activeMint() ?? "";
  const of = useMemo(
    () => [activeMint, ...Object.keys(balances).filter((mint) => balances[mint] > 0).sort()].join(" "),
    [activeMint, balances]
  );
  // answers stand while the wallet's mints and the catalogue do
  const fresh = answers.of === of && answers.catalog === models;
  const routed = useMemo<Routed>(
    () => (fresh ? Object.fromEntries(Object.entries(answers.at).filter((a): a is [string, string] => !!a[1])) : {}),
    [fresh, answers]
  );
  const model = useMemo(
    () => pickedModel(models, pick) ?? autoPick(models, catalog, pick.chosen, pay, routed),
    [models, pick, catalog, pay, routed]
  );
  // The SDK's rule takes an await, so it is asked here for the models where its
  // answer matters (the one in use, and any a key's credit decides) and read
  // back at once; until it answers, a model reads its cheapest provider.
  const asked = useMemo(() => {
    const ids = new Set(models.filter((m) => pay.decides(m)).map((m) => m.id));
    if (model) ids.add(model.id);
    return [...ids].filter((id) => !fresh || !(id in answers.at));
  }, [models, pay, model, fresh, answers]);
  useEffect(() => {
    if (!catalog || !asked.length) return;
    let live = true;
    const wallet = { balances, activeMint };
    void Promise.all(asked.map(async (id) => [id, (await catalog.goesTo(id, wallet))?.baseUrl ?? null] as const)).then((got) => {
      if (live)
        setAnswers((was) => ({
          of,
          catalog: models,
          at: { ...(was.of === of && was.catalog === models ? was.at : {}), ...Object.fromEntries(got) },
        }));
    });
    return () => {
      live = false;
    };
  }, [catalog, asked, balances, activeMint, of, models]);
  // ranked again whenever the catalogue changes (a cooldown keeps the same models), not on
  // every render of the composer
  const sent = useMemo(() => {
    if (!model || !catalog) return { provider: undefined, priced: model };
    const routes = catalog.routes(model.id);
    const provider = goesTo(model, pick.chosen, routes, routed[model.id]);
    const listed = routes.find((r) => r.baseUrl === provider)?.model as unknown as Model | undefined;
    return { provider, priced: listed ?? model };
  }, [model, pick.chosen, catalog, models, routed]);
  return { ...pick, models, loading, model, ...sent, routed };
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
      const model =
        pickedModel(value.models, value) ?? autoPick(value.models, catalog, value.chosen, payable(total + sats, credit, !!node), value.routed);
      if (!model) return [];
      const base = goesTo(model, value.chosen, catalog.routes(model.id), value.routed[model.id]);
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
 *  message to it goes to, and the model as that provider prices it. With the
 *  catalogue and the pick's own state. */
export function useChatModel() {
  const value = useContext(ChatModelContext);
  if (!value) throw new Error("useChatModel must be used inside ChatModelProvider");
  return value;
}

const slashed = (url: string) => (url.endsWith("/") ? url : `${url}/`);

/** What the chat engine is told about a model: the pin, while the catalogue
 *  still routes this model to it, and whether it reads images. */
export function chatModelOf(
  model: Model,
  chosen: Choice | null,
  routes: { baseUrl: string }[]
): { id: string; provider?: string; images?: boolean } {
  // a pin is kept as main keys it: with a scheme and a closing slash
  const pinned =
    chosen?.id === model.id && chosen.provider
      ? routes.find((r) => slashed(r.baseUrl) === chosen.provider)?.baseUrl
      : undefined;
  const inputs = model.architecture?.input_modalities;
  // unknown inputs are not taken as text only
  return { id: model.id, provider: pinned, images: inputs ? inputs.some((m) => normalizeModality(m) === "image") : undefined };
}

/** Where a message to this model goes: its pin while routing still serves it
 *  there, else where the SDK's own rule sends it (`routed`, while routing still
 *  has it), else the cheapest provider. */
export function goesTo(model: Model, chosen: Choice | null, routes: { baseUrl: string }[], routed?: string): string | undefined {
  const sdk = routed ? routes.find((r) => slashed(r.baseUrl) === slashed(routed))?.baseUrl : undefined;
  return chatModelOf(model, chosen, routes).provider ?? sdk ?? routes[0]?.baseUrl;
}
