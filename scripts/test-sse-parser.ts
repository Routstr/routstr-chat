import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Readable } from "stream";
import { createSSEParserTransform } from "../sdk/client/sse";
import type { UsageTrackingData } from "../sdk/client/usage";
import * as fs from "fs";

type ParsedArgs = {
  daemon: boolean;
  passthrough: boolean;
  inputPath: string;
  port: number;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let daemon = false;
  let passthrough = false;
  let inputPath: string | undefined;
  let port = 3456;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--daemon") {
      daemon = true;
      continue;
    }

    if (arg === "--passthrough") {
      passthrough = true;
      continue;
    }

    if (arg === "--port") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --port");
      }
      port = Number.parseInt(value, 10);
      if (!Number.isFinite(port)) {
        throw new Error(`Invalid port: ${value}`);
      }
      i += 1;
      continue;
    }

    if (!inputPath) {
      inputPath = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    daemon,
    passthrough,
    inputPath: inputPath ?? "scripts/1776631508420.jsonl",
    port,
  };
}

function getTotalBytes(chunks: string[]) {
  return chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0);
}

async function loadRawChunks(inputPath: string): Promise<string[]> {
  const content = await fs.promises.readFile(inputPath, "utf8");
  const chunks: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as { raw?: string };
    if (typeof parsed.raw === "string") {
      chunks.push(parsed.raw);
    }
  }

  return chunks;
}

async function parseFile(inputPath: string, passthrough: boolean) {
  const startedAt = Date.now();
  const rawChunks = await loadRawChunks(inputPath);

  if (passthrough) {
    for (const chunk of rawChunks) {
      process.stdout.write(chunk);
    }

    console.log("\n--- SUMMARY ---");
    console.log("Input file:", inputPath);
    console.log("Mode:", "passthrough");
    console.log("Output bytes:", getTotalBytes(rawChunks));
    console.log("Duration ms:", Date.now() - startedAt);
    return;
  }

  let capturedUsage: UsageTrackingData | undefined;
  let capturedResponseId: string | undefined;

  const sseParser = createSSEParserTransform(
    (usage) => {
      capturedUsage = usage;
      console.log("USAGE_CAPTURED", usage);
    },
    (responseId) => {
      capturedResponseId = responseId;
      console.log("RESPONSE_ID_CAPTURED", responseId);
    }
  );

  const source = new Readable({
    read() {},
  });

  const outputChunks: string[] = [];
  sseParser.on("data", (chunk) => {
    const text = chunk.toString();
    outputChunks.push(text);
    process.stdout.write(text);
  });

  for (const chunk of rawChunks) {
    source.push(chunk);
  }
  source.push(null);

  await new Promise<void>((resolve, reject) => {
    source.pipe(sseParser);
    sseParser.once("end", resolve);
    sseParser.once("error", reject);
    source.once("error", reject);
  });

  const durationMs = Date.now() - startedAt;

  console.log("\n--- SUMMARY ---");
  console.log("Input file:", inputPath);
  console.log("Mode:", "parsed");
  console.log("Response ID:", capturedResponseId ?? "<none>");
  console.log("Usage:", capturedUsage ?? "<none>");
  console.log("Usage cost USD:", capturedUsage?.cost ?? 0);
  console.log("Usage cost sats:", capturedUsage?.satsCost ?? 0);
  console.log("Output bytes:", getTotalBytes(outputChunks));
  console.log("Duration ms:", durationMs);
}

async function handleDaemonRequest(
  req: IncomingMessage,
  res: ServerResponse,
  inputPath: string,
  passthrough: boolean
) {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  for await (const _chunk of req) {
  }

  const rawChunks = await loadRawChunks(inputPath);
  if (!passthrough) {
    const source = new Readable({
      read() {},
    });
    const sseParser = createSSEParserTransform();
    const parsedChunks: string[] = [];

    for (const chunk of rawChunks) {
      source.push(chunk);
    }
    source.push(null);

    await new Promise<void>((resolve, reject) => {
      source.pipe(sseParser);
      sseParser.on("data", (chunk) => {
        parsedChunks.push(chunk.toString());
      });
      sseParser.once("end", resolve);
      sseParser.once("error", reject);
      source.once("error", reject);
    });

    rawChunks.length = 0;
    rawChunks.push(...parsedChunks);
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  for (const chunk of rawChunks) {
    res.write(chunk);
  }

  res.end();
}

async function runDaemon(inputPath: string, port: number, passthrough: boolean) {
  const server = createServer((req, res) => {
    void handleDaemonRequest(req, res, inputPath, passthrough).catch((error) => {
      console.error(error);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end("Internal server error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve());
    server.once("error", reject);
  });

  console.log(`Serving ${inputPath} on http://127.0.0.1:${port}/v1/chat/completions`);
}

async function main() {
  const { daemon, passthrough, inputPath, port } = parseArgs();

  if (daemon) {
    await runDaemon(inputPath, port, passthrough);
    return;
  }

  await parseFile(inputPath, passthrough);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
