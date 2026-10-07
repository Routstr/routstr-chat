import { describe, expect, it, vi } from "vitest";
import type { Model } from "@/types/models";
import { payable } from "./useMoney";

// sats_pricing.max_cost is what one message may take
const model = (need: number) => ({ id: "m", name: "M", sats_pricing: need ? { max_cost: need } : undefined }) as unknown as Model;
const AT = "https://a.example/";
const ELSEWHERE = "https://b.example/";

describe("payable: what can pay for a message at the provider it goes to", () => {
  it("counts a key's credit only at its own provider", () => {
    const pay = payable(0, { [AT]: 30 }, false);
    expect(pay.at(AT)).toBe(30);
    expect(pay.covers(model(20), AT)).toBe(true);
    // the same credit does nothing for a message that goes somewhere else
    expect(pay.at(ELSEWHERE)).toBe(0);
    expect(pay.covers(model(20), ELSEWHERE)).toBe(false);
    expect(pay.covers(model(20), undefined)).toBe(false);
  });

  it("adds the wallet to it, whatever the address's closing slash", () => {
    const pay = payable(15, { [AT]: 10 }, false);
    expect(pay.at("https://a.example")).toBe(25);
    expect(pay.covers(model(25), "https://a.example")).toBe(true);
    expect(pay.covers(model(26), AT)).toBe(false);
  });

  it("with no key credit (X-Cashu pays each message from the wallet), only the wallet counts", () => {
    const pay = payable(15, {}, false);
    expect(pay.covers(model(15), AT)).toBe(true);
    expect(pay.covers(model(16), AT)).toBe(false);
  });

  it("lets a node pay for anything, and a model of unknown price go when something can pay", () => {
    expect(payable(0, {}, true).covers(model(500), AT)).toBe(true);
    expect(payable(0, {}, false).covers(model(0), AT)).toBe(false);
    expect(payable(0, { [AT]: 1 }, false).covers(model(0), AT)).toBe(true);
  });

  it("works out where a message goes only when a key's credit decides it", () => {
    const where = vi.fn(() => AT);
    // the wallet alone pays: wherever it goes
    expect(payable(30, { [AT]: 30 }, false).covers(model(20), where)).toBe(true);
    // no key holds enough to make up the rest
    expect(payable(5, { [AT]: 10 }, false).covers(model(20), where)).toBe(false);
    expect(where).not.toHaveBeenCalled();
    // short alone, and a key could make it up: only there
    expect(payable(15, { [AT]: 10 }, false).covers(model(20), where)).toBe(true);
    expect(payable(15, { [AT]: 10 }, false).covers(model(20), () => ELSEWHERE)).toBe(false);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
