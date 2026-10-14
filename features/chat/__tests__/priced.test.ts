import { fetchAIResponse, ProviderManager } from "@routstr/sdk";
import { describe, expect, it } from "vitest";
import type { Message } from "@/types/chat";
import { CatalogService } from "@/features/catalog/service";
import { createAttachments } from "../attachments";
import type { FileStore, StoredFile } from "../ports";
import { pricedRequest } from "../priced";

// a model whose node gate counts every character of the request: 1,000 sats at most
const model = {
  id: "m",
  context_length: 400_000,
  top_provider: { context_length: 400_000, max_completion_tokens: 8_000 },
  sats_pricing: {
    prompt: 0.002,
    completion: 0.01,
    max_prompt_cost: 784,
    max_completion_cost: 80,
    max_cost: 1_000,
  },
};

/** What the SDK asks for a request carrying these messages, by its own rule. */
const need = (messages: unknown[]) =>
  new ProviderManager({} as never).getRequiredSatsForModel(
    model as never,
    messages,
    undefined,
    { model: model.id, messages, stream: true }
  );

/** A data: URL holding `bytes` bytes (not a picture the SDK can read). */
const data = (type: string, bytes: number) =>
  `data:${type};base64,${Buffer.alloc(bytes, 7).toString("base64")}`;
const PICTURE = data("image/png", 30_000);
const PDF = data("application/pdf", 50_000);

const branch: Message[] = [
  { role: "user", content: "draw a red apple" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Here it is." },
      {
        type: "image_url",
        image_url: { url: "", size: 30_000, storageId: "pic" },
      },
    ],
  },
  {
    role: "user",
    content: [
      { type: "text", text: "and read this" },
      {
        type: "file",
        file: {
          url: "",
          name: "a.pdf",
          mimeType: "application/pdf",
          size: 50_000,
          storageId: "pdf",
        },
      },
      { type: "text", text: "PDF attachment (a.pdf):\n\nhello", hidden: true },
    ],
  },
  { role: "assistant", content: "Read it." },
];

describe("pricedRequest: the request a send would make, as the SDK prices it", () => {
  it("prices a chat with saved pictures and files as the request that loads them", async () => {
    const stored: Record<string, string> = { pic: PICTURE, pdf: PDF };
    const files = {
      load: async (file: StoredFile) => stored[file.storageId ?? ""],
    } as unknown as FileStore;
    const question: Message["content"] = [
      { type: "text", text: "now make it blue" },
      { type: "image_url", image_url: { url: data("image/png", 2_000) } },
    ];
    const sent = await createAttachments(files).forRequest(
      [...branch, { role: "user", content: question }],
      new AbortController().signal
    );

    const priced = pricedRequest(branch, question, true)!;
    expect(need(priced)).toBe(need(sent));
    // the pictures and the file count: the words alone ask less
    expect(need(priced)).toBeGreaterThan(
      need([{ role: "user", content: "now make it blue" }])
    );
  });

  it("leaves the pictures out for a model that reads text only", () => {
    const priced = pricedRequest(branch, "next", false)!;
    expect(JSON.stringify(priced)).not.toContain("image_url");
    expect(need(priced)).toBeLessThan(
      need(pricedRequest(branch, "next", true)!)
    );
  });

  it("knows nothing when a saved picture's size was never kept", () => {
    const old: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "image_url", image_url: { url: "", storageId: "pic" } },
        ],
      },
    ];
    expect(pricedRequest(old, "next", true)).toBeNull();
    // a text-only model is never sent it, so it does not count
    expect(pricedRequest(old, "next", false)).not.toBeNull();
  });

  it("is what the SDK asks for the body it really sends, OpenAI's search tool included", async () => {
    const openai = { ...model, id: "gpt-x", name: "OpenAI: GPT X" };
    const chat: Message[] = [
      { role: "user", content: "hello" },
      { role: "system", content: "Generation stopped." },
      { role: "assistant", content: "Hi, how can I help?" },
    ];
    // the body fetchAIResponse builds and sends, caught at the transport
    let sent: { messages: unknown[] } | undefined;
    await fetchAIResponse(
      {
        selectedModel: openai as never,
        baseUrl: "https://provider.example/",
        mintUrl: "https://mint.example/",
        messageHistory: [
          ...chat,
          { role: "user", content: "and now?" },
        ] as never,
      },
      {
        onStreamingUpdate: () => {},
        onThinkingUpdate: () => {},
        onMessageAppend: () => {},
        onBalanceUpdate: () => {},
        onTransactionUpdate: () => {},
      } as never,
      {
        client: {
          routeRequest: async ({ body }: { body: { messages: unknown[] } }) => {
            sent = body;
            return new Response("data: [DONE]\n\n");
          },
        },
        alertLevel: "min",
        getPendingCashuTokenAmount: () => 0,
      } as never
    );
    const pm = new ProviderManager({} as never);
    const catalog = new CatalogService({ providerManager: pm } as never);

    expect(
      catalog.need(openai as never, pricedRequest(chat, "and now?", true))
    ).toBe(
      pm.getRequiredSatsForModel(
        openai as never,
        sent!.messages,
        undefined,
        sent as never
      )
    );
  });

  it("is what the SDK asks when the reply is capped, less than for the model's longest reply", async () => {
    const long = { ...model, id: "long", name: "Long", top_provider: { context_length: 400_000, max_completion_tokens: 128_000 }, sats_pricing: { ...model.sats_pricing, max_completion_cost: 1_280 } };
    let sent: { messages: unknown[] } | undefined;
    await fetchAIResponse(
      {
        selectedModel: long as never,
        baseUrl: "https://provider.example/",
        mintUrl: "https://mint.example/",
        messageHistory: [{ role: "user", content: "hi" }] as never,
        maxTokens: 64_000,
      },
      {
        onStreamingUpdate: () => {},
        onThinkingUpdate: () => {},
        onMessageAppend: () => {},
        onBalanceUpdate: () => {},
        onTransactionUpdate: () => {},
      } as never,
      {
        client: {
          routeRequest: async ({ body }: { body: { messages: unknown[] } }) => {
            sent = body;
            return new Response("data: [DONE]\n\n");
          },
        },
        alertLevel: "min",
        getPendingCashuTokenAmount: () => 0,
      } as never
    );
    const pm = new ProviderManager({} as never);
    const catalog = new CatalogService({ providerManager: pm } as never);
    const capped = catalog.need(long as never, pricedRequest([], "hi", true), 64_000);

    expect(capped).toBe(pm.getRequiredSatsForModel(long as never, sent!.messages, 64_000, sent as never));
    expect(capped).toBeLessThan(catalog.need(long as never, pricedRequest([], "hi", true)));
  });
});
