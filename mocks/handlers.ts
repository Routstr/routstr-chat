import { http, HttpResponse, delay } from "msw";
import type { JsonBodyType } from "msw";

// Dev-only error injection for chat completions, keyed off localStorage. See README.
// Never mock the mint here: top-ups pay real invoices, canned keysets strand the ecash.

type ErrorScenario = {
  aliases: string[];
  status: number;
  requestId?: string;
  body: { text: string } | { json: JsonBodyType };
};

const routstrError = (message: string, code: string, status: number) => ({
  json: { error: { message, code, status } },
});

const SCENARIOS: ErrorScenario[] = [
  {
    aliases: ["401", "unauthorized"],
    status: 401,
    requestId: "7ee5gg8b-9d41-5cbe-c2aa-50d0555eg07d",
    body: routstrError(
      "Unauthorized - Invalid or expired token",
      "UNAUTHORIZED",
      401
    ),
  },
  {
    aliases: ["403", "forbidden"],
    status: 403,
    requestId: "8ff6hh9c-0e52-6dcf-d3bb-61e1666fh18e",
    body: routstrError(
      "Forbidden - Insufficient permissions",
      "FORBIDDEN",
      403
    ),
  },
  {
    aliases: ["402", "payment-required"],
    status: 402,
    requestId: "9gg7ii0d-1f63-7edg-e4cc-72f2777gi29f",
    body: routstrError(
      "Payment Required - Insufficient balance",
      "PAYMENT_REQUIRED",
      402
    ),
  },
  {
    aliases: ["413", "payload-too-large"],
    status: 413,
    requestId: "6dd4ff7a-8c30-4bad-b199-49c9444df96c",
    body: routstrError("Payload Too Large", "PAYLOAD_TOO_LARGE", 413),
  },
  {
    aliases: ["500", "internal-server-error"],
    status: 500,
    requestId: "0hh8jj1e-2g74-8feh-f5dd-83g3888hj30g",
    body: routstrError(
      "Internal Server Error - Something went wrong on the server",
      "INTERNAL_SERVER_ERROR",
      500
    ),
  },
  {
    aliases: ["502", "bad-gateway"],
    status: 502,
    requestId: "1ii9kk2f-3h85-9gfi-g6ee-94h4999ik41h",
    body: routstrError(
      "Bad Gateway - Server received an invalid response",
      "BAD_GATEWAY",
      502
    ),
  },
  {
    // Plain text, because that is what the provider actually returns here.
    aliases: ["400", "bad-request", "invalid-model"],
    status: 400,
    requestId: "a00b11c-4i96-0hjj-h7ff-05i5000jl52i",
    body: { text: "model-xyz is not a valid model ID" },
  },
  {
    aliases: ["400-model-not-found"],
    status: 400,
    body: {
      json: {
        error: {
          message: "Model 'gpt-oss-20b' not found",
          type: "invalid_model",
          code: 400,
        },
        request_id: "17f6608b-f8af-454e-9e97-8d71cdc849e3",
      },
    },
  },
];

const NAMED_LATENCY: Record<string, number> = { slow: 1500, timeout: 10000 };

async function applyLatency(request: Request): Promise<void> {
  const raw = request.headers.get("X-Mock-Latency");
  if (!raw) return;
  const ms = Number.isNaN(Number(raw))
    ? (NAMED_LATENCY[raw] ?? 0)
    : Number(raw);
  if (ms > 0) await delay(ms);
}

export const handlers = [
  http.post("*/v1/chat/completions", async ({ request }) => {
    const requested = request.headers.get("X-Mock-Scenario")?.toLowerCase();
    if (!requested) return;

    const scenario = SCENARIOS.find((s) => s.aliases.includes(requested));
    if (!scenario) return;

    await applyLatency(request);

    const headers: Record<string, string> = {
      "Content-Type":
        "text" in scenario.body ? "text/plain" : "application/json",
    };
    if (scenario.requestId)
      headers["x-routstr-request-id"] = scenario.requestId;

    return "text" in scenario.body
      ? HttpResponse.text(scenario.body.text, {
          status: scenario.status,
          headers,
        })
      : HttpResponse.json(scenario.body.json, {
          status: scenario.status,
          headers,
        });
  }),
];
