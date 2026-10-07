import { describe, expect, it } from "vitest";
import { createSdk } from "../sdk";

const CHEAP = "https://cheap.example/";
const DEAR = "https://dear.example/";
const X = "https://mint-x.example";
const Y = "https://mint-y.example";
const Z = "https://mint-z.example";

const model = (prompt: number) => ({
  id: "m",
  name: "M",
  sats_pricing: { prompt, completion: prompt },
});

/** Two providers of one model: the cheap one takes only mint X, the dear one
 *  only mint Y. */
async function routing() {
  const sdk = createSdk({ extraProviders: [] });
  await sdk.ready;
  const discovery = sdk.discoveryAdapter;
  discovery.setBaseUrlsList([CHEAP, DEAR]);
  discovery.setCachedModels({
    [CHEAP]: [model(1)],
    [DEAR]: [model(2)],
  } as never);
  discovery.setCachedMints({ [CHEAP]: [X], [DEAR]: [Y] });
  return sdk;
}

describe("route: where the SDK pays, by its own rule", () => {
  it("is the cheapest provider that takes a mint holding sats", async () => {
    const { route } = await routing();

    expect(await route("m", { balances: { [X]: 50 }, activeMint: X })).toEqual({
      baseUrl: CHEAP,
      mintUrl: X,
    });
    expect(await route("m", { balances: { [Y]: 50 }, activeMint: Y })).toEqual({
      baseUrl: DEAR,
      mintUrl: Y,
    });
    // two mints: the active one, while the provider takes it
    expect(
      await route("m", { balances: { [X]: 50, [Y]: 50 }, activeMint: Y })
    ).toEqual({ baseUrl: CHEAP, mintUrl: X });
  });

  it("is the cheapest when no provider takes a mint holding sats", async () => {
    const { route } = await routing();

    expect(
      await route("m", { balances: { [Z]: 50 }, activeMint: Z })
    ).toMatchObject({ baseUrl: CHEAP });
  });
});
