import { http, HttpResponse, delay } from "msw";

function getScenario(request: Request): string | null {
  const header = request.headers.get("X-Mock-Scenario");
  return header ? header.toLowerCase() : null;
}

export const handlers = [
  http.post("*/v1/chat/completions", async ({ request }) => {
    const scenario = getScenario(request);

    if (scenario && (scenario === "401" || scenario === "unauthorized")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Unauthorized - Invalid or expired token",
            code: "UNAUTHORIZED",
            status: 401,
          },
        },
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "7ee5gg8b-9d41-5cbe-c2aa-50d0555eg07d",
          },
        }
      );
    }

    if (scenario && (scenario === "403" || scenario === "forbidden")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Forbidden - Insufficient permissions",
            code: "FORBIDDEN",
            status: 403,
          },
        },
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "8ff6hh9c-0e52-6dcf-d3bb-61e1666fh18e",
          },
        }
      );
    }

    if (scenario && (scenario === "402" || scenario === "payment-required")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Payment Required - Insufficient balance",
            code: "PAYMENT_REQUIRED",
            status: 402,
          },
        },
        {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "9gg7ii0d-1f63-7edg-e4cc-72f2777gi29f",
          },
        }
      );
    }

    if (
      scenario &&
      (scenario === "400" ||
        scenario === "bad-request" ||
        scenario === "invalid-model")
    ) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.text("model-xyz is not a valid model ID", {
        status: 400,
        headers: {
          "Content-Type": "text/plain",
          "x-routstr-request-id": "a00b11c-4i96-0hjj-h7ff-05i5000jl52i",
        },
      });
    }

    if (scenario && scenario === "400-model-not-found") {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Model 'gpt-oss-20b' not found",
            type: "invalid_model",
            code: 400,
          },
          request_id: "17f6608b-f8af-454e-9e97-8d71cdc849e3",
        },
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (scenario && (scenario === "413" || scenario === "payload-too-large")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Payload Too Large",
            code: "PAYLOAD_TOO_LARGE",
            status: 413,
          },
        },
        {
          status: 413,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "6dd4ff7a-8c30-4bad-b199-49c9444df96c",
          },
        }
      );
    }

    if (
      scenario &&
      (scenario === "500" || scenario === "internal-server-error")
    ) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message:
              "Internal Server Error - Something went wrong on the server",
            code: "INTERNAL_SERVER_ERROR",
            status: 500,
          },
        },
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "0hh8jj1e-2g74-8feh-f5dd-83g3888hj30g",
          },
        }
      );
    }

    if (scenario && (scenario === "502" || scenario === "bad-gateway")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Bad Gateway - Server received an invalid response",
            code: "BAD_GATEWAY",
            status: 502,
          },
        },
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "1ii9kk2f-3h85-9gfi-g6ee-94h4999ik41h",
          },
        }
      );
    }

    return;
  }),
];
