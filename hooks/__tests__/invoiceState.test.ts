import { MeltQuoteState, MintQuoteState } from "@cashu/cashu-ts";
import { expect, it } from "vitest";
import { forward, mergeInvoice } from "../invoiceState";
import type { StoredInvoice } from "../useInvoiceSync";

const { UNPAID, PAID, ISSUED } = MintQuoteState;
const invoice = (over: Partial<StoredInvoice>): StoredInvoice => ({
  id: "i1",
  type: "mint",
  mintUrl: "https://m",
  quoteId: "q1",
  paymentRequest: "lnbc1",
  amount: 8,
  state: UNPAID,
  createdAt: 1,
  ...over,
});

it("never lets a copy checked later move a claimed invoice back", () => {
  const cloud = invoice({ state: ISSUED, checkedAt: 10 });
  // this device read UNPAID before the claim, and wrote it after
  const local = invoice({ state: UNPAID, checkedAt: 20, retryCount: 2 });
  expect(mergeInvoice(cloud, local)).toEqual({ ...local, state: ISSUED });
  expect(mergeInvoice(local, cloud)).toEqual({ ...local, state: ISSUED });
  // forward, as ever
  expect(
    mergeInvoice(local, invoice({ state: PAID, checkedAt: 30 })).state
  ).toBe(PAID);
});

it("keeps a mint invoice's state on an update that says less, and lets a melt's go back", () => {
  expect(forward(invoice({ state: ISSUED }), invoice({ state: PAID }))).toBe(
    ISSUED
  );
  expect(forward(invoice({ state: PAID }), invoice({ state: ISSUED }))).toBe(
    ISSUED
  );
  const melt = (state: MeltQuoteState) => invoice({ type: "melt", state });
  expect(
    forward(melt(MeltQuoteState.PENDING), melt(MeltQuoteState.UNPAID))
  ).toBe(MeltQuoteState.UNPAID);
});
