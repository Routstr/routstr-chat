import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import { EMPTY } from "rxjs";

import { eventStore } from "@/lib/applesauce-core";
import { eventDatabaseReady } from "@/lib/eventDatabase";
import {
  discoveryAdapter,
  hydrate,
  modelManager,
  providerManager,
  store,
} from "@/sdk/sharedStore";

const baseUrl = "https://provider.example/";
const modelId = "test/model";
const privateKey = (value: number) =>
  Uint8Array.from({ length: 32 }, (_, index) => (index === 31 ? value : 0));
const reviewerKey = privateKey(1);
const providerKey = privateKey(2);
const reviewerPubkey = getPublicKey(reviewerKey);
const providerPubkey = getPublicKey(providerKey);
const now = Math.floor(Date.now() / 1000);
const announcement = finalizeEvent(
  {
    kind: 38421,
    created_at: now - 1,
    tags: [
      ["d", "provider.example"],
      ["u", baseUrl],
    ],
    content: "",
  },
  providerKey
);
const review = finalizeEvent(
  {
    kind: 38425,
    created_at: now,
    tags: [
      ["d", "provider.example-review"],
      ["node", providerPubkey],
      ["t", "lgtm"],
    ],
    content: "",
  },
  reviewerKey
);

type ModelManagerInternals = {
  providerNodePubkeysByUrl: Map<string, Set<string>>;
  queryLastUpdate: Map<string, number>;
  relayPool: unknown;
  routstrPubkey: string;
};

const manager = modelManager as unknown as ModelManagerInternals;
let originalStoreState: ReturnType<typeof store.getState>;
let originalManagerState: ModelManagerInternals;

describe("provider discovery reload wiring", () => {
  beforeEach(async () => {
    await Promise.all([hydrate, eventDatabaseReady]);
    originalStoreState = store.getState();
    originalManagerState = {
      providerNodePubkeysByUrl: new Map(
        [...manager.providerNodePubkeysByUrl].map(([url, pubkeys]) => [
          url,
          new Set(pubkeys),
        ])
      ),
      queryLastUpdate: new Map(manager.queryLastUpdate),
      relayPool: manager.relayPool,
      routstrPubkey: manager.routstrPubkey,
    };

    eventStore.add(announcement);
    eventStore.add(review);
    manager.relayPool = { request: () => EMPTY };
    manager.routstrPubkey = reviewerPubkey;

    const timestamp = Date.now();
    store.setState({
      baseUrlsList: [baseUrl],
      lastBaseUrlsUpdate: timestamp,
      disabledProviders: [],
      manuallyDisabledProviders: [],
      manuallyEnabledProviders: [],
      modelsFromAllProviders: {
        [baseUrl]: [
          {
            id: modelId,
            name: "Test model",
            sats_pricing: {
              prompt: 0.000001,
              completion: 0.000002,
              request: 0,
              image: 0,
              web_search: 0,
              internal_reasoning: 0,
              max_completion_cost: 1,
              max_prompt_cost: 1,
              max_cost: 2,
            },
          },
        ],
      },
      lastModelsUpdate: { [baseUrl]: timestamp },
      routstr21Models: [modelId],
      lastRoutstr21ModelsUpdate: timestamp,
    });
  });

  afterEach(() => {
    eventStore.remove(announcement);
    eventStore.remove(review);
    store.setState(originalStoreState);
    Object.assign(manager, originalManagerState);
  });

  it("keeps a warm provider routable when relays are unavailable", async () => {
    expect(providerManager.getBestProviderForModel(modelId)).toBe(baseUrl);

    await modelManager.bootstrapProviders(false, false);

    expect(discoveryAdapter.getDisabledProviders()).toEqual([]);
    expect(providerManager.getBestProviderForModel(modelId)).toBe(baseUrl);
    expect(await modelManager.getEventStore()).toBe(eventStore);
  });
});
