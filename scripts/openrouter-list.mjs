// Writes components/v2/picker/openrouter.json from OpenRouter's public model list: each model's
// list price, what the picker's Deals compare a node's price with, and its Artificial Analysis
// Intelligence Index where OpenRouter lists one. The app ships this copy and never asks
// OpenRouter itself. Run it now and then: `pnpm openrouter-list`, or
// `pnpm openrouter-list models.json` with that list saved where openrouter.ai can be reached.
import { readFileSync, statSync, writeFileSync } from "node:fs";

const saved = process.argv[2];
const { data } = saved
  ? JSON.parse(readFileSync(saved, "utf8"))
  : await fetch("https://openrouter.ai/api/v1/models").then((res) => {
      if (!res.ok) throw new Error(`openrouter.ai answered ${res.status}`);
      return res.json();
    });
const fetched = (saved ? statSync(saved).mtime : new Date()).toISOString().slice(0, 10);

const prices = {};
const intelligence = {};
for (const m of data) {
  // a variant (":free", ":batch") is the model itself, but its price is no measure of the model's
  const [id, variant] = m.id.split(":");
  const index = m.benchmarks?.artificial_analysis?.intelligence_index;
  if (typeof index === "number" && index > 0 && !(variant && id in intelligence)) intelligence[id] = index;
  if (variant) continue;
  const prompt = Number(m.pricing?.prompt);
  const completion = Number(m.pricing?.completion);
  if (prompt > 0 && completion > 0) prices[id] = [prompt, completion];
}
const n = Object.keys(prices).length;
if (n < 100) throw new Error(`only ${n} priced models: not writing`);

// one model a line, so a refresh reads as a short diff
const block = (o) =>
  Object.keys(o)
    .sort()
    .map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(o[id])}`)
    .join(",\n");
const out = `{
  "source": "https://openrouter.ai/api/v1/models",
  "fetched": "${fetched}",
  "prices": {
${block(prices)}
  },
  "intelligence": {
${block(intelligence)}
  }
}
`;
writeFileSync(new URL("../components/v2/picker/openrouter.json", import.meta.url), out);
console.log(`${n} models priced, ${Object.keys(intelligence).length} with an intelligence index`);
