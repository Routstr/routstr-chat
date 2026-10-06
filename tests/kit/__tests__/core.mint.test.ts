// Real routstr-core through the kit: what a paid reply costs, what comes back, and that
// every sat is accounted for at the mint. These pin the provider behaviour the chat
// pipeline relies on, so a core or kit change that breaks it shows up here first. Every
// token core hands back is redeemed at the mint: that is what proves it real.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { getKit, type Behaviour } from "..";
import { fcParams } from "../props";

const kit = getKit();

async function chat(
  auth: Record<string, string>,
  content: string,
  model = "kit-echo"
) {
  const res = await fetch(`${kit.coreUrl}v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      stream: true,
    }),
  });
  const body = await res.text();
  const text = body
    .split("\n")
    .filter((l) => l.startsWith("data: {"))
    .map(
      (l) =>
        JSON.parse(l.slice(6)) as {
          choices?: { delta?: { content?: string } }[];
        }
    )
    .map((c) => c.choices?.[0]?.delta?.content ?? "")
    .join("");
  const costMsats = Number(res.headers.get("x-routstr-cost-msats") ?? 0);
  return {
    status: res.status,
    text,
    change: res.headers.get("x-cashu"),
    costMsats,
  };
}

const info = async (key: string) =>
  (await (
    await fetch(`${kit.coreUrl}v1/wallet/info`, {
      headers: { authorization: `Bearer ${key}` },
    })
  ).json()) as { api_key: string; balance: number };

describe("X-Cashu", () => {
  it("charges the reply in whole sats and returns the rest as change", async () => {
    const token = await kit.mintToken(200);
    const r = await chat({ "X-Cashu": token }, "hello kit");
    expect(r.status).toBe(200);
    expect(r.text).toBe("Echo: hello kit");
    expect(r.costMsats).toBeGreaterThan(0);
    // core rounds the charge up to a whole sat on a sat mint
    expect(await kit.redeem(r.change!)).toBe(
      200 - Math.ceil(r.costMsats / 1000)
    );
    expect(new Set(await kit.tokenStates(token))).toEqual(new Set(["SPENT"])); // core took the coins
  });

  it.each([500, 429])(
    "returns everything when the upstream fails with %i before any bytes",
    async (status) => {
      const token = await kit.mintToken(100);
      const r = await chat({ "X-Cashu": token }, `[kit:fail=${status}] hi`);
      expect(r.status).not.toBe(200);
      expect(await kit.redeem(r.change!)).toBe(100);
    }
  );

  // KNOWN CORE GAP (core df89c0a5), pinned as it is today: after a cut stream core answers
  // 500, keeps the coins and never writes the refund, so the claim answers 425 "pending"
  // for good. The SDK keeps retrying and the reply's sats stay at the provider. When core
  // fixes it this test fails: then change it to expect the 150 sats back.
  it("keeps the money when the stream is cut mid-way (known core gap)", async () => {
    const token = await kit.mintToken(150);
    const r = await chat(
      { "X-Cashu": token },
      "[kit:cut=2] one two three four"
    );
    expect(r.status).toBe(500);
    expect(r.change).toBeNull();
    expect(new Set(await kit.tokenStates(token))).toEqual(new Set(["SPENT"]));
    for (let i = 0; i < 3; i++) {
      const claim = await fetch(`${kit.coreUrl}v1/wallet/refund`, {
        method: "POST",
        headers: { "X-Cashu": token },
      });
      expect(claim.status).toBe(425);
      await new Promise((res) => setTimeout(res, 1000));
    }
  });

  // a property over many paid replies: whatever the upstream does, paid = change + charge,
  // a failed reply is never charged, and no reply costs more than the model's max
  it("never loses or overcharges a sat, whatever the upstream does", async () => {
    const models = (await (await fetch(`${kit.coreUrl}v1/models`)).json()) as {
      data: { id: string; sats_pricing: { max_cost: number } }[];
    };
    const maxCost = Object.fromEntries(
      models.data.map((m) => [m.id, m.sats_pricing.max_cost])
    );
    const behaviour = fc.oneof(
      fc.constant<Behaviour>({}),
      fc.record<Behaviour>({ fail: fc.constantFrom(500, 502, 429, 400) }),
      fc.record<Behaviour>({ slowMs: fc.integer({ min: 0, max: 300 }) }),
      fc.record<Behaviour>({
        usage: fc.record({
          prompt: fc.integer({ min: 1, max: 4000 }),
          completion: fc.integer({ min: 1, max: 1000 }),
        }),
      })
    );
    await fc.assert(
      fc.asyncProperty(
        behaviour,
        fc.integer({ min: 120, max: 400 }),
        fc.constantFrom("kit-echo", "kit-cheap"),
        async (b, sats, model) => {
          await kit.upstream.queue(b);
          const token = await kit.mintToken(sats);
          const r = await chat({ "X-Cashu": token }, "property check", model);
          const back = r.change ? await kit.redeem(r.change) : 0;
          const charged = sats - back;
          if (r.status !== 200) expect(charged).toBe(0);
          else expect(charged).toBe(Math.ceil(r.costMsats / 1000));
          expect(charged).toBeLessThanOrEqual(Math.ceil(maxCost[model]));
        }
      ),
      fcParams({ numRuns: 12 })
    );
  }, 180_000);
});

// How soon the first byte comes, for a reply the upstream takes ~1.8 s to write. Core
// needs the final cost before it can put the change in the X-Cashu header, so it holds
// those replies whole; API-key replies stream. Generous margins: a busy machine is slow.
it("streams API-key replies but holds X-Cashu ones until the end", async () => {
  const firstByte = async (auth: Record<string, string>) => {
    const t0 = Date.now();
    const res = await fetch(`${kit.coreUrl}v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({
        model: "kit-echo",
        messages: [
          { role: "user", content: "[kit:chunk=300] [kit:text=a b c d e f]" },
        ],
        stream: true,
      }),
    });
    const reader = res.body!.getReader();
    await reader.read();
    const ms = Date.now() - t0;
    while (!(await reader.read()).done);
    return ms;
  };
  expect(
    await firstByte({ "X-Cashu": await kit.mintToken(200) })
  ).toBeGreaterThanOrEqual(1500);
  const key = (await info(await kit.mintToken(300))).api_key;
  expect(await firstByte({ authorization: `Bearer ${key}` })).toBeLessThan(
    1000
  );
});

describe("API key", () => {
  it("creates a key from a token, charges replies, tops up and refunds, losing nothing but rounding", async () => {
    const models = (await (await fetch(`${kit.coreUrl}v1/models`)).json()) as {
      data: { id: string; sats_pricing: { max_cost: number } }[];
    };
    const maxMsats =
      models.data.find((m) => m.id === "kit-echo")!.sats_pricing.max_cost *
      1000;
    const created = await info(await kit.mintToken(300));
    expect(created.balance).toBe(300_000);
    const key = created.api_key;
    expect(key).toMatch(/^sk-/);

    const r = await chat({ authorization: `Bearer ${key}` }, "hi");
    expect(r.status).toBe(200);
    expect(r.text).toBe("Echo: hi");
    // core sends no cost header for API keys: the charge is what left the key's balance
    const afterChat = (await info(key)).balance;
    expect(300_000 - afterChat).toBeGreaterThan(0);
    expect(300_000 - afterChat).toBeLessThanOrEqual(maxMsats);

    const top = await fetch(`${kit.coreUrl}v1/wallet/topup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ cashu_token: await kit.mintToken(50) }),
    });
    expect(await top.json()).toEqual({ msats: 50_000 });

    const refund = (await (
      await fetch(`${kit.coreUrl}v1/wallet/refund`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
      })
    ).json()) as { token: string };
    expect(await kit.redeem(refund.token)).toBe(
      Math.floor((afterChat + 50_000) / 1000)
    );
  });
});
