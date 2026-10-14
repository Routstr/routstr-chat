import { describe, expect, it, vi } from "vitest";
import type { Model } from "@/types/models";
import { payable } from "./useMoney";

// what one message may take: 20 here, so a new key starts at 28
const model = (need: number) => ({ id: "m", name: "M", sats_pricing: { max_cost: need } }) as unknown as Model;
const need = (m: Model) => m.sats_pricing?.max_cost ?? 0;
// a wallet whose sats sit at one mint every provider takes
const one = (sats: number) => () => sats;
const AT = "https://a.example/";
const ELSEWHERE = "https://b.example/";

describe("payable: what a send takes from the wallet where it goes, and whether it is there", () => {
  it("counts a key's credit only at its own provider", () => {
    const pay = payable(one(0), { [AT]: 30 }, false, need);
    expect(pay.takes(model(20), AT)).toBe(0);
    expect(pay.covers(model(20), AT)).toBe(true);
    // the same credit does nothing for a send that goes somewhere else
    expect(pay.takes(model(20), ELSEWHERE)).toBe(28);
    expect(pay.covers(model(20), ELSEWHERE)).toBe(false);
    expect(pay.covers(model(20), undefined)).toBe(false);
  });

  it("asks the wallet for the SDK's top-up of a key that holds too little, whatever the closing slash", () => {
    expect(payable(one(15), { [AT]: 10 }, false, need).takes(model(20), "https://a.example")).toBe(18);
    expect(payable(one(17), { [AT]: 10 }, false, need).covers(model(20), AT)).toBe(false);
    expect(payable(one(18), { [AT]: 10 }, false, need).covers(model(20), "https://a.example")).toBe(true);
  });

  it("with no key there yet, asks for a first deposit", () => {
    expect(payable(one(27), {}, false, need).covers(model(20), AT)).toBe(false);
    expect(payable(one(28), {}, false, need).covers(model(20), AT)).toBe(true);
    expect(payable(one(6), {}, false, need).covers(model(2), AT)).toBe(false);
    expect(payable(one(7), {}, false, need).covers(model(2), AT)).toBe(true);
  });

  it("on X-Cashu (no key is spent) every message carries a token of its own need", () => {
    expect(payable(one(20), null, false, need).covers(model(20), AT)).toBe(true);
    expect(payable(one(19), null, false, need).covers(model(20), AT)).toBe(false);
  });

  it("lets a node pay for anything", () => {
    expect(payable(one(0), null, true, need).covers(model(500), AT)).toBe(true);
    expect(payable(one(0), null, true, need).takes(model(500), AT)).toBe(0);
  });

  it("works out where a send goes only when a key's credit decides it", () => {
    const where = vi.fn(() => AT);
    // the wallet alone pays: wherever it goes
    expect(payable(one(28), { [AT]: 30 }, false, need).covers(model(20), where)).toBe(true);
    // no key holds enough to make up the rest
    expect(payable(one(5), { [AT]: 10 }, false, need).covers(model(20), where)).toBe(false);
    expect(where).not.toHaveBeenCalled();
    // short alone, and a key could make it up: only there
    expect(payable(one(18), { [AT]: 10 }, false, need).covers(model(20), where)).toBe(true);
    expect(payable(one(18), { [AT]: 10 }, false, need).covers(model(20), () => ELSEWHERE)).toBe(false);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("counts only what one mint the provider takes can pay, as the SDK pays from one mint", () => {
    // 30 sats in all: 20 at a mint AT takes, 10 at one only ELSEWHERE takes
    const spendable = (where?: string | null) => (where === AT ? 20 : where === ELSEWHERE ? 10 : 20);
    expect(payable(spendable, {}, false, need).covers(model(10), AT)).toBe(true);
    // a first deposit of 28 is more than any one mint holds, though the wallet has 30
    expect(payable(spendable, {}, false, need).covers(model(20), AT)).toBe(false);
    expect(payable(spendable, {}, false, need).covers(model(10), ELSEWHERE)).toBe(false);
  });

  it("counts a key's credit where the send goes, though no mint there holds a first deposit", () => {
    // 50 sats at a mint AT does not take, and AT's key holds 30: a message of 20 takes nothing
    const elsewhere = (where?: string | null) => (where === AT ? 0 : 50);
    expect(payable(elsewhere, { [AT]: 30 }, false, need).covers(model(20), AT)).toBe(true);
    // AT's key holds 10: the refill of 18 comes from a mint AT takes, which holds 18
    const some = (where?: string | null) => (where === AT ? 18 : 50);
    expect(payable(some, { [AT]: 10 }, false, need).covers(model(20), AT)).toBe(true);
  });
});
