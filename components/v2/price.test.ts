import { describe, expect, it } from "vitest";
import type { Model } from "@/types/models";
import { needOf } from "./price";

const priced = (sats_pricing?: Partial<NonNullable<Model["sats_pricing"]>>) => ({ id: "m", name: "M", sats_pricing }) as unknown as Model;

describe("needOf: what one message may take before it is sent", () => {
  it("is room for 10,000 prompt tokens and the longest reply, 5% over", () => {
    expect(needOf(priced({ prompt: 0.001, completion: 0.002, max_completion_cost: 2.048, max_cost: 9.216 }))).toBeCloseTo(12.6504, 6);
  });

  it("is the model's max cost when it names no longest reply, else 50", () => {
    expect(needOf(priced({ prompt: 0.001, max_cost: 9.216 }))).toBe(9.216);
    expect(needOf(priced({ prompt: 0.001 }))).toBe(50);
  });

  it("is 0 when the price is unknown", () => {
    expect(needOf(priced())).toBe(0);
  });
});
