import { describe, expect, it } from "vitest";
import type { Model } from "@/types/models";
import { estimateSats } from "./price";

const priced = (sats_pricing: Record<string, number>) => ({ id: "m", name: "M", sats_pricing }) as unknown as Model;

describe("estimateSats: what one reply is shown to cost before it is sent", () => {
  it("is the words so far and a reply of ordinary length", () => {
    expect(estimateSats(priced({ prompt: 0.001, completion: 0.002 }), 1000)).toBe(3);
  });

  // routstr.otrta.me, 10-14: Nano Banana 2 Lite lists 0.00198 a word token and 0.03954 a picture
  // token, and its one-picture reply (1,120 picture tokens) cost 44 sats
  it("is a picture's worth for a model whose node prices picture tokens", () => {
    const lite = priced({ prompt: 0.000329, completion: 0.00198, image_output: 0.03954 });
    expect(estimateSats(lite, 10)).toBeGreaterThanOrEqual(44);
    expect(estimateSats(lite, 10)).toBeLessThan(60);
  });

  // ai.redsh1ft.com, 10-14: its listing has no picture price, yet a Nano Banana picture cost 39 sats
  it("prices a picture at the rate another node lists when its own node lists none", () => {
    const older = priced({ prompt: 0.000385, completion: 0.00321 });
    expect(estimateSats(older, 10, 0.03954)).toBeGreaterThanOrEqual(39);
  });
});
