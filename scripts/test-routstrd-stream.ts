import * as fs from "fs";
import * as path from "path";

const API_URL = process.env.ROUTSTRD_URL || "http://localhost:8008/v1/chat/completions";
const OUTPUT_DIR = path.join(process.cwd(), "scripts", "stream-response");
const decoder = new TextDecoder();

function getAuthHeader(): string {
  const token = process.env.ROUTSTR_XCASHU_TOKEN || process.env.ROUTSTRD_AUTH_TOKEN;
  return `Bearer ${token}`;
}

function buildPayload() {
  return {
    model: process.env.ROUTSTR_TEST_MODEL || "gemma-3n-e4b-it",
    messages: [
      {
        role: "user",
        content:
          process.env.ROUTSTR_TEST_PROMPT ||
          "Give a short answer about whether SSE chunk boundaries match message boundaries.",
      },
    ],
    stream: true,
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const startedAt = Date.now();
  const logPath = path.join(OUTPUT_DIR, `${startedAt}-routstrd.jsonl`);
  const payload = buildPayload();

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(payload),
  });

  console.log("url", API_URL);
  console.log("status", response.status, response.statusText);
  console.log("content-type", response.headers.get("content-type"));
  console.log("log", logPath);

  if (!response.body) {
    throw new Error("Response body missing");
  }

  const writer = fs.createWriteStream(logPath, { flags: "a" });
  const reader = response.body.getReader();

  let reads = 0;
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      reads += 1;
      totalBytes += value.byteLength;

      const raw = decoder.decode(value, { stream: true });
      writer.write(
        JSON.stringify({
          raw,
          byteLength: value.byteLength,
          readIndex: reads,
          timestamp: Date.now(),
        }) + "\n"
      );

      process.stdout.write(raw);
    }

    const trailing = decoder.decode();
    if (trailing) {
      writer.write(
        JSON.stringify({
          raw: trailing,
          byteLength: Buffer.byteLength(trailing),
          readIndex: reads + 1,
          timestamp: Date.now(),
          trailing: true,
        }) + "\n"
      );
      process.stdout.write(trailing);
    }
  } finally {
    writer.end();
  }

  console.log("\n--- SUMMARY ---");
  console.log("reads", reads);
  console.log("bytes", totalBytes);
  console.log("duration_ms", Date.now() - startedAt);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
