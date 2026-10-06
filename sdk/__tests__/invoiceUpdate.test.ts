import { MeltQuoteState } from "@cashu/cashu-ts";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // invoices are kept in localStorage under "lightning_invoices"
  const memory = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
  };
  Object.assign(globalThis, { localStorage, window: { localStorage } });
});

vi.mock("react", () => ({
  useState: (init: unknown) => [
    typeof init === "function" ? init() : init,
    vi.fn(),
  ],
  useEffect: () => undefined,
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("applesauce-react/hooks", () => ({
  useObservableState: () => undefined,
}));
vi.mock("@/components/ClientProviders", () => ({
  useAccountManager: () => ({ manager: { active$: {} } }),
}));
vi.mock("@/hooks/useAppContext", () => ({
  useAppContext: () => ({ config: { relayUrls: [] } }),
}));
// signed out, so nothing is published: only the observables read while rendering are needed
vi.mock("@/hooks/sync", () => ({
  invoices$: {},
  configSyncLoading$: {},
  configSyncEose$: {},
}));

import { useInvoiceSync } from "@/hooks/useInvoiceSync";

describe("updateInvoice", () => {
  it("updates an invoice when the payment flow only knows its quote id", async () => {
    const { addInvoice, updateInvoice } = useInvoiceSync();
    await addInvoice({
      type: "melt",
      mintUrl: "https://mint.example.com",
      quoteId: "quote-1",
      paymentRequest: "lnbc100n1",
      amount: 10,
      state: MeltQuoteState.UNPAID,
    });

    // as useWalletSend and SixtyWallet do after payMeltQuote
    await updateInvoice("quote-1", { state: MeltQuoteState.PAID });

    const stored = JSON.parse(localStorage.getItem("lightning_invoices")!);
    expect(stored.invoices.map((i: { state: string }) => i.state)).toEqual([
      "PAID",
    ]);
  });
});
