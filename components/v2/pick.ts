import { createContext, useContext, useSyncExternalStore } from "react";
import type { Model } from "@/types/models";
import { baseKey, parseKey } from "./picker/catalog";

/* Which model you talk to, the ones you keep at hand, and the provider you
   pinned for each. Device-wide, in main's keys, so a choice made in either
   app holds in the other. */

const LAST = "lastUsedModel";
const MINE = "configured_models";
const OLD_MINE = "favorite_models";
const PINS = "model_provider_map";

/** A model, and the provider (a base URL) you pinned it to, if any. */
export interface Choice {
  id: string;
  provider?: string;
}

export interface PickState {
  /** Your choice, kept on this device. */
  chosen: Choice | null;
  /** A "?model=" link's model, for this visit only, until you choose. */
  link: Choice | null;
  /** Your models, as main keys them: an id, or "id@@base" with a pin. */
  configured: string[];
  /** The provider you last picked for a model. */
  pins: Record<string, string>;
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

/** A choice from main's key for it. */
export function choiceOf(key: string): Choice {
  const { id, base } = parseKey(key);
  return base ? { id, provider: baseKey(base) } : { id };
}

/** Main's key for a choice. */
export const keyOf = (choice: Choice) => (choice.provider ? `${choice.id}@@${choice.provider}` : choice.id);

/** The model a choice names in the catalogue as it is now; a link may give a
 *  provider's full id ("openai/gpt-5") where the list has the short one. */
export function modelFor(models: Model[], choice: Choice | null): Model | null {
  if (!choice) return null;
  const short = choice.id.split("/").pop() || choice.id;
  return models.find((m) => m.id === choice.id) ?? models.find((m) => m.id === short) ?? null;
}

/** The model in use: a link's when the list has it, else your choice's.
 *  Null means neither is in the list: take `defaultModel`. */
export const pickedModel = (models: Model[], pick: Pick<PickState, "chosen" | "link">) =>
  modelFor(models, pick.link) ?? modelFor(models, pick.chosen);

/** With nothing chosen, or the choice gone: the first of Routstr's picks you
 *  can afford, else the costliest you can afford, as main picked. `need` is
 *  what one message may take, in sats; a model whose need is unknown is skipped. */
export function defaultModel(models: Model[], picks: string[], spendable: number, need: (m: Model) => number): Model | null {
  const fits = (m: Model) => {
    const n = need(m);
    return n > 0 && spendable >= n;
  };
  for (const id of picks) {
    const m = models.find((x) => x.id === id);
    if (m && fits(m)) return m;
  }
  let best: Model | null = null;
  for (const m of models) if (fits(m) && (!best || need(m) > need(best))) best = m;
  return best;
}

export class ModelPick {
  private state: PickState;
  private listeners = new Set<() => void>();

  /** `search`: the page's query; a "?model=" link picks for this visit without replacing your choice. */
  constructor(
    private storage: KeyValueStorage,
    search = ""
  ) {
    const fromLink = new URLSearchParams(search).get("model")?.trim();
    const last = this.readText(LAST);
    let configured = this.read<string[] | null>(MINE, null);
    if (configured === null) {
      // main's older name for the list
      configured = this.read<string[]>(OLD_MINE, []);
      if (configured.length) this.write(MINE, configured);
    }
    this.state = {
      chosen: last ? choiceOf(last) : null,
      link: fromLink ? { id: fromLink } : null,
      configured,
      pins: this.read<Record<string, string>>(PINS, {}),
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PickState => this.state;

  choose = (choice: Choice): void => {
    this.write(LAST, keyOf(choice));
    this.set({ chosen: choice, link: null });
  };

  toggle = (key: string): void => {
    const now = this.state.configured;
    this.setConfigured(now.includes(key) ? now.filter((k) => k !== key) : [...now, key]);
  };

  setConfigured = (keys: string[]): void => {
    this.write(MINE, keys);
    this.set({ configured: keys });
  };

  pin = (id: string, base: string): void => {
    const pins = { ...this.state.pins, [id]: base };
    this.write(PINS, pins);
    this.set({ pins });
  };

  private set(change: Partial<PickState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }

  private raw(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private read<T>(key: string, fallback: T): T {
    const raw = this.raw(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /** A string main may have stored quoted or bare. */
  private readText(key: string): string | null {
    const raw = this.raw(key);
    if (raw === null) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === "string" ? value : null;
    } catch {
      return raw;
    }
  }

  private write(key: string, value: unknown) {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full or blocked: the choice holds for this visit
    }
  }
}

/** The pick state. Filled by UiProvider. */
export const PickContext = createContext<ModelPick | null>(null);

export function useModelPick() {
  const pick = useContext(PickContext);
  if (!pick) throw new Error("useModelPick must be used inside UiProvider");
  const state = useSyncExternalStore(pick.subscribe, pick.getSnapshot, pick.getSnapshot);
  return { ...state, choose: pick.choose, toggle: pick.toggle, setConfigured: pick.setConfigured, pin: pick.pin };
}
