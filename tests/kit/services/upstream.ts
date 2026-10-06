// A fake OpenAI-style LLM upstream for routstr-core, plus the few outside APIs core asks for
// prices (OpenRouter's model list, BTC/USD tickers). Core reaches those through the
// redirect in core_launcher.py, so nothing leaves the machine.
//
// How a reply behaves is picked, first match wins, by:
//   1. a directive in the last user message, e.g. "[kit:slow=1500] hi" (see Behaviour below)
//   2. the next queued behaviour (queue(), or POST /_kit/queue from another process)
//   3. a normal streamed echo
import http from "node:http";

export interface Behaviour {
  /** wait this long before the first byte */
  slowMs?: number;
  /** wait this long between chunks */
  chunkMs?: number;
  /** answer with this HTTP status and an error body, before any bytes */
  fail?: number;
  /** send this many content chunks, then cut the connection (no usage, no [DONE]) */
  cut?: number;
  /** never answer */
  hang?: boolean;
  /** send reasoning chunks before the answer */
  think?: boolean;
  /** the reply text; defaults to an echo of the question */
  text?: string;
  /** override the reported usage */
  usage?: { prompt: number; completion: number };
}

export interface UpstreamRequest {
  at: number; // Date.now() when it arrived
  model: string;
  stream: boolean;
  behaviour: Behaviour;
  firstByteAt?: number;
  endedAt?: number;
  outcome?: "ok" | "failed" | "cut" | "aborted";
}

/** USD per token. Core turns these into sats with BTC_USD below. */
export const MODELS = [
  {
    id: "kit-echo",
    name: "Kit Echo",
    prompt: 0.00001,
    completion: 0.00003,
    context: 8192,
    maxOut: 1024,
  },
  {
    id: "kit-cheap",
    name: "Kit Cheap",
    prompt: 0.000001,
    completion: 0.000002,
    context: 8192,
    maxOut: 1024,
  },
];
export const BTC_USD = 100_000; // 1 sat = $0.001
export const API_KEY = "kit-upstream-key";

const DIRECTIVE = /\[kit:([a-z]+)(?:=([^\]]*))?\]/g;

export function parseDirectives(text: string): Behaviour | undefined {
  let found: Behaviour | undefined;
  for (const [, name, value] of text.matchAll(DIRECTIVE)) {
    found ??= {};
    if (name === "slow") found.slowMs = Number(value ?? 1000);
    else if (name === "chunk") found.chunkMs = Number(value ?? 50);
    else if (name === "fail") found.fail = Number(value ?? 500);
    else if (name === "cut") found.cut = Number(value ?? 2);
    else if (name === "hang") found.hang = true;
    else if (name === "think") found.think = true;
    else if (name === "text") found.text = value ?? "";
    else if (name === "usage") {
      const [p, c] = (value ?? "").split(",").map(Number);
      found.usage = { prompt: p || 1, completion: c || 1 };
    }
  }
  return found;
}

type ChatMessage = {
  role: string;
  content: string | { type: string; text?: string }[];
};
const textOf = (m?: ChatMessage) =>
  !m
    ? ""
    : typeof m.content === "string"
      ? m.content
      : m.content
          .map((p) => (p.type === "text" ? p.text : `[${p.type}]`))
          .join(" ");
const tokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Upstream {
  url: string; // http://127.0.0.1:<port>  (core's UPSTREAM_BASE_URL is url + "/v1")
  queue(...behaviours: Behaviour[]): void;
  requests: UpstreamRequest[];
  close(): Promise<void>;
}

export async function startUpstream(port = 0): Promise<Upstream> {
  const queued: Behaviour[] = [];
  const requests: UpstreamRequest[] = [];
  const sockets = new Set<import("node:net").Socket>();

  const json = (res: http.ServerResponse, status: number, body: unknown) =>
    res
      .writeHead(status, { "content-type": "application/json" })
      .end(JSON.stringify(body));

  async function chat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    raw: string
  ) {
    if (req.headers.authorization !== `Bearer ${API_KEY}`)
      return json(res, 401, { error: { message: "bad upstream key" } });
    const body = JSON.parse(raw) as {
      model: string;
      messages: ChatMessage[];
      stream?: boolean;
      stream_options?: { include_usage?: boolean };
    };
    const question = textOf(
      [...body.messages].reverse().find((m) => m.role === "user")
    );
    const behaviour = parseDirectives(question) ?? queued.shift() ?? {};
    const record: UpstreamRequest = {
      at: Date.now(),
      model: body.model,
      stream: !!body.stream,
      behaviour,
    };
    requests.push(record);
    res.on("close", () => (record.outcome ??= "aborted"));

    if (behaviour.hang) return;
    if (behaviour.slowMs) await sleep(behaviour.slowMs);
    if (behaviour.fail) {
      record.outcome = "failed";
      return json(res, behaviour.fail, {
        error: {
          message: `kit upstream failed with ${behaviour.fail}`,
          type: "upstream_error",
        },
      });
    }

    const reply =
      behaviour.text ?? `Echo: ${question.replace(DIRECTIVE, "").trim()}`;
    const words = reply.split(/(?<= )/);
    const reasoning = behaviour.think
      ? "Thinking about it. ".repeat(3).split(/(?<= )/)
      : [];
    const usage = {
      prompt_tokens:
        behaviour.usage?.prompt ?? tokens(body.messages.map(textOf).join(" ")),
      completion_tokens:
        behaviour.usage?.completion ?? tokens(reasoning.join("") + reply),
    };
    const id = `chatcmpl-kit-${requests.length}`;
    const created = Math.floor(Date.now() / 1000);
    const usageOut = {
      ...usage,
      total_tokens: usage.prompt_tokens + usage.completion_tokens,
    };

    if (!body.stream) {
      record.firstByteAt = record.endedAt = Date.now();
      record.outcome = "ok";
      return json(res, 200, {
        id,
        object: "chat.completion",
        created,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage: usageOut,
      });
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const chunk = (delta: object, finish: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      );
    record.firstByteAt = Date.now();
    chunk({ role: "assistant", content: "" });
    for (const r of reasoning) {
      if (behaviour.chunkMs) await sleep(behaviour.chunkMs);
      chunk({ reasoning: r, reasoning_content: r });
    }
    for (const [i, w] of words.entries()) {
      if (behaviour.cut !== undefined && i >= behaviour.cut) {
        record.outcome = "cut";
        return req.socket.destroy();
      }
      if (behaviour.chunkMs) await sleep(behaviour.chunkMs);
      chunk({ content: w });
    }
    chunk({}, "stop");
    if (body.stream_options?.include_usage)
      res.write(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: body.model, choices: [], usage: usageOut })}\n\n`
      );
    res.end("data: [DONE]\n\n");
    record.endedAt = Date.now();
    record.outcome = "ok";
  }

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "POST" && /^(\/v1)?\/chat\/completions$/.test(path))
        return void chat(req, res, raw).catch((e) =>
          res.headersSent
            ? res.destroy()
            : json(res, 500, { error: { message: String(e) } })
        );
      // control routes for tests in other processes (see ../client.ts)
      if (req.method === "POST" && path === "/_kit/queue")
        return (
          queued.push(...(JSON.parse(raw) as Behaviour[])),
          json(res, 200, { ok: true })
        );
      if (req.method === "POST" && path === "/_kit/reset")
        return (
          (queued.length = requests.length = 0),
          json(res, 200, { ok: true })
        );
      if (path === "/_kit/requests") return json(res, 200, requests);
      if (req.method !== "GET")
        return json(res, 404, { error: { message: "not here" } });
      // the upstream's own list (what core's provider sees as available)
      if (/^(\/v1)?\/models$/.test(path))
        return json(res, 200, {
          object: "list",
          data: MODELS.map((m) => ({
            id: m.id,
            object: "model",
            created: 0,
            owned_by: "kit",
          })),
        });
      // OpenRouter's list, which core uses for prices and context sizes
      if (path === "/api/v1/models")
        return json(res, 200, {
          data: MODELS.map((m) => ({
            id: m.id,
            canonical_slug: m.id,
            name: m.name,
            created: 0,
            description: "kit model",
            context_length: m.context,
            architecture: {
              modality: "text->text",
              input_modalities: ["text"],
              output_modalities: ["text"],
              tokenizer: "Other",
              instruct_type: null,
            },
            pricing: {
              prompt: String(m.prompt),
              completion: String(m.completion),
              request: "0",
              image: "0",
              web_search: "0",
              internal_reasoning: "0",
            },
            top_provider: {
              context_length: m.context,
              max_completion_tokens: m.maxOut,
              is_moderated: false,
            },
            per_request_limits: null,
            supported_parameters: ["max_tokens", "temperature", "stream"],
          })),
        });
      if (path === "/api/v1/embeddings/models")
        return json(res, 200, { data: [] });
      if (path === "/0/public/Ticker")
        return json(res, 200, {
          error: [],
          result: { XXBTZUSD: { c: [String(BTC_USD), "1"] } },
        });
      if (path === "/v2/prices/BTC-USD/spot")
        return json(res, 200, {
          data: { amount: String(BTC_USD), base: "BTC", currency: "USD" },
        });
      if (path === "/api/v3/ticker/price")
        return json(res, 200, { symbol: "BTCUSDT", price: String(BTC_USD) });
      json(res, 404, { error: { message: `kit upstream has no ${path}` } });
    });
  });
  server.on(
    "connection",
    (s) => (sockets.add(s), s.on("close", () => sockets.delete(s)))
  );
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve)
  );
  const { port: bound } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${bound}`,
    queue: (...b) => void queued.push(...b),
    requests,
    close: () =>
      new Promise<void>(
        (resolve) => (
          sockets.forEach((s) => s.destroy()),
          server.close(() => resolve())
        )
      ),
  };
}
