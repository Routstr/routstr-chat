import { extractUsageFromSSEJson, type UsageTrackingData } from "./usage";

function maybeCaptureUsageFromJson(
  jsonText: string,
  onUsage: (usage: UsageTrackingData) => void,
  onResponseId?: (responseId: string) => void
): void {
  try {
    const data = JSON.parse(jsonText) as any;
    const responseId = data.id;
    if (typeof responseId === "string" && responseId.trim().length > 0) {
      onResponseId?.(responseId.trim());
    }

    const usage = extractUsageFromSSEJson(data);
    if (usage) {
      onUsage(usage);
    }
  } catch {
    // Ignore non-JSON lines/events.
  }
}

function inspectSSETextChunk(
  text: string,
  onUsage: (usage: UsageTrackingData) => void,
  onResponseId?: (responseId: string) => void
): void {
  const events = text.split(/\r?\n\r?\n/);

  for (const event of events) {
    const trimmedEvent = event.trim();
    if (!trimmedEvent) continue;

    const lines = trimmedEvent.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) {
        continue;
      }

      const dataStr = trimmed.startsWith("data: ")
        ? trimmed.slice(6)
        : trimmed.slice(5).trimStart();

      if (!dataStr || dataStr === "[DONE]") {
        continue;
      }

      maybeCaptureUsageFromJson(dataStr, onUsage, onResponseId);
    }
  }
}

export function createSSETrackingStream(
  body: globalThis.ReadableStream<Uint8Array>,
  onUsage: (usage: UsageTrackingData) => void,
  onResponseId?: (responseId: string) => void
): globalThis.ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let parseBuffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();

      if (done) {
        parseBuffer += decoder.decode();
        if (parseBuffer) {
          inspectSSETextChunk(parseBuffer, onUsage, onResponseId);
          parseBuffer = "";
        }
        controller.close();
        return;
      }

      parseBuffer += decoder.decode(value, { stream: true });

      const lastEventBoundary = parseBuffer.lastIndexOf("\n\n");
      const lastCrLfEventBoundary = parseBuffer.lastIndexOf("\r\n\r\n");
      const boundary = Math.max(lastEventBoundary, lastCrLfEventBoundary);

      if (boundary >= 0) {
        const completeText = parseBuffer.slice(0, boundary + (boundary === lastCrLfEventBoundary ? 4 : 2));
        inspectSSETextChunk(completeText, onUsage, onResponseId);
        parseBuffer = parseBuffer.slice(boundary + (boundary === lastCrLfEventBoundary ? 4 : 2));
      }

      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
