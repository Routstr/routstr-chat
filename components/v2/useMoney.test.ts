import { describe, expect, it, vi } from "vitest";
import type { Model } from "@/types/models";
import { payable } from "./useMoney";

// sats_pricing.max_cost is what one message may take: 20 here, so a new key starts at 28
const model = (need: number) => ({ id: "m", name: "M", sats_pricing: { max_cost: need } }) as unknown as Model;
const AT = "https://a.example/";
const ELSEWHERE = "https://b.example/";

describe("payable: what a send takes from the wallet where it goes, and whether it is there", () => {
  it("counts a key's credit only at its own provider", () => {
    const pay = payable(0, { [AT]: 30 }, false);
    expect(pay.takes(model(20), AT)).toBe(0);
    expect(pay.covers(model(20), AT)).toBe(true);
    // the same credit does nothing for a send that goes somewhere else
    expect(pay.takes(model(20), ELSEWHERE)).toBe(28);
    expect(pay.covers(model(20), ELSEWHERE)).toBe(false);
    expect(pay.covers(model(20), undefined)).toBe(false);
  });

  it("asks the wallet for the SDK's top-up of a key that holds too little, whatever the closing slash", () => {
    expect(payable(15, { [AT]: 10 }, false).takes(model(20), "https://a.example")).toBe(18);
    expect(payable(17, { [AT]: 10 }, false).covers(model(20), AT)).toBe(false);
    expect(payable(18, { [AT]: 10 }, false).covers(model(20), "https://a.example")).toBe(true);
  });

  it("with no key there yet, asks for a first deposit", () => {
    expect(payable(27, {}, false).covers(model(20), AT)).toBe(false);
    expect(payable(28, {}, false).covers(model(20), AT)).toBe(true);
    expect(payable(6, {}, false).covers(model(2), AT)).toBe(false);
    expect(payable(7, {}, false).covers(model(2), AT)).toBe(true);
  });

  it("on X-Cashu (no key is spent) every message carries a token of its own need", () => {
    expect(payable(20, null, false).covers(model(20), AT)).toBe(true);
    expect(payable(19, null, false).covers(model(20), AT)).toBe(false);
  });

  it("lets a node pay for anything", () => {
    expect(payable(0, null, true).covers(model(500), AT)).toBe(true);
    expect(payable(0, null, true).takes(model(500), AT)).toBe(0);
  });

  it("works out where a send goes only when a key's credit decides it", () => {
    const where = vi.fn(() => AT);
    // the wallet alone pays: wherever it goes
    expect(payable(28, { [AT]: 30 }, false).covers(model(20), where)).toBe(true);
    // no key holds enough to make up the rest
    expect(payable(5, { [AT]: 10 }, false).covers(model(20), where)).toBe(false);
    expect(where).not.toHaveBeenCalled();
    // short alone, and a key could make it up: only there
    expect(payable(18, { [AT]: 10 }, false).covers(model(20), where)).toBe(true);
    expect(payable(18, { [AT]: 10 }, false).covers(model(20), () => ELSEWHERE)).toBe(false);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
