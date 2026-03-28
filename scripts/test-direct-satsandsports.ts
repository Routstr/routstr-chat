const API_URL = "https://llm.satsandsports.cash/v1/chat/completions";
const API_KEY =
  process.env.OPENROUTER_API_KEY ||
  process.env.ROUTSTR_UPSTREAM_API_KEY ||
  "sk-20165ace90de66fa8c3536084ac4bdfb6891aa7a6a9c5ebaa6eee61db0fabd92";

async function main() {
  const payload = {
    model: "gemma-3n-e4b-it",
    messages: [
      {
        role: "user",
        content: "count from 1 to 10, one token-ish chunk at a time",
      },
    ],
    stream: true,
  };

  const start = Date.now();
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  console.log("status", response.status, response.statusText);
  console.log("content-type", response.headers.get("content-type"));

  if (!response.body) {
    throw new Error("Response body missing");
  }

  const reader = response.body.getReader();
  let last = start;
  let reads = 0;

  while (true) {
    const before = Date.now();
    const { done, value } = await reader.read();
    const now = Date.now();

    if (done) {
      console.log(`done total=${now - start}ms reads=${reads}`);
      break;
    }

    reads += 1;
    console.log(
      `read#${reads} total=${now - start}ms wait=${now - before}ms dt=${now - last}ms bytes=${value.byteLength}`
    );
    last = now;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
