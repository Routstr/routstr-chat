import { ReplyCosts } from "@/features/chat/costs";
import { DEFAULT_FILE_SERVERS, type ChatHistory, type Pay } from "@/features/chat/ports";
import { ChatService } from "@/features/chat/service";
import type { AccountChatView } from "@/features/chat/view";
import type { CatalogService } from "@/features/catalog/service";
import { ANSWER_2, STREAM_3, THINKING } from "@/components/v2/lab/FakeChat";
import { LAB_MODELS, PICKS, labRoutes } from "@/components/v2/lab/catalog";

/* Development only. The real chat engine over the lab's chats, paid by a
   pretend provider that streams canned words, so /lab draws every state of a
   turn as the app does without spending sats. ?fail=1 ?nothink=1 ?loading=1 */

const LAB_SYNC = { on: false, servers: DEFAULT_FILE_SERVERS };

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

export function labChat(history: ChatHistory, params: URLSearchParams): AccountChatView {
  const pay: Pay = async ({ messages }, callbacks, signal) => {
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
    callbacks.onPaymentProcessing?.(true);
    await wait(700);
    if (params.get("fail")) {
      await wait(2400);
      if (!signal.aborted) callbacks.onMessageAppend?.({ role: "system", content: "The provider did not respond to this request." });
      return;
    }
    await wait(1600);
    if (!params.get("nothink")) {
      const words = THINKING.split(/(\s+)/);
      let acc = "";
      for (let i = 0; i < words.length && !signal.aborted; i += 3) {
        acc += words.slice(i, i + 3).join("");
        callbacks.onThinkingUpdate?.(acc);
        await wait(40 + Math.random() * 40);
      }
    }
    const parts = (messages.length > 3 ? STREAM_3 : ANSWER_2).split(/(\s+)/);
    let acc = "";
    for (let i = 0; i < parts.length && !signal.aborted; ) {
      // bursty: the network hands over a few words, then pauses
      const n = 2 + Math.floor(Math.random() * 10);
      acc += parts.slice(i, i + n).join("");
      i += n;
      callbacks.onStreamingUpdate?.(acc);
      await wait(40 + Math.random() * 160);
    }
    if (signal.aborted) return;
    callbacks.onMessageAppend?.({ role: "assistant", content: acc });
    callbacks.onRequestId?.(`lab-${Date.now()}`);
  };
  const costs = new ReplyCosts(memory(), "costs", async () => 18 + Math.round(Math.random() * 20));
  const chat = new ChatService({
    history,
    attachments: { forRequest: async (sent) => sent as never, forSave: async (message) => message },
    pay,
    costs,
  });
  return {
    chat,
    costs,
    refund: async () => [],
    held: { subscribe: () => () => {}, get: () => 0 },
    viewing: () => {},
    // files stay inline in the lab: nothing is kept or copied
    files: {
      load: async () => undefined,
      store: async () => ({}),
      keep: async () => `lab-${Date.now()}`,
      copy: async () => ({}),
      sync: () => LAB_SYNC,
      setSync: () => {},
      subscribe: () => () => {},
      cleanup: async () => {},
    },
  };
}

/** The lab's catalogue behind the catalogue view. */
export function labCatalog(params: URLSearchParams): CatalogService {
  const snapshot = params.has("loading") ? { models: [], loading: true, off: [], turnedOff: [] } : { models: LAB_MODELS, loading: false, off: [], turnedOff: [] };
  const catalog: Pick<CatalogService, "subscribe" | "getSnapshot" | "picks" | "routes" | "refresh" | "mintsOf" | "providers" | "listing" | "listedAt"> = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    picks: () => PICKS,
    routes: (id) => labRoutes(id).map((r) => ({ baseUrl: r.base, model: r.model })) as never,
    refresh: async () => {},
    // the lab names no provider's mints: new money keeps the wallet's own default
    mintsOf: () => [],
    providers: () => [],
    listing: () => [],
    listedAt: () => undefined,
  };
  return catalog as CatalogService;
}
