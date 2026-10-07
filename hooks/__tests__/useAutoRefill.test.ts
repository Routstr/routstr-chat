import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  payWithNWC: vi.fn(async (..._: unknown[]) => ({ success: true })),
}));

// one render: effects run at once, each context holds what the test put in it
vi.mock("react", () => ({
  createContext: (value: unknown) => ({ value }),
  useContext: (context: { value: unknown }) => context.value,
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void) => void effect(),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@/utils/storageUtils", async (actual) => ({
  ...(await actual<object>()),
  loadAutoRefillNWCSettings: () => ({ enabled: true, threshold: 50, amount: 100 }),
  updateNWCLastRefillTime: vi.fn(),
}));
vi.mock("@/lib/nwcPayment", () => ({
  isNWCConnected: async () => true,
  payWithNWC: state.payWithNWC,
}));
vi.mock("@/features/wallet", () => ({
  useCashuWallet: () => ({ updateProofs: vi.fn() }),
}));
vi.mock("@/features/wallet/hooks/purseBridge", async (actual) => ({
  ...(await actual<object>()),
  listMint: vi.fn(async () => undefined),
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import { AcceptedMintsContext } from "@/features/wallet/view";
import { useAutoRefill } from "../useAutoRefill";

/** one render of the app part that mounts auto-refill */
function App({ balance }: { balance: number }) {
  useAutoRefill({ balance, isWalletLoaded: true });
  return null;
}

it("refills at a mint the provider takes for that amount, as Add does", async () => {
  const accepted = vi.fn((_sats: number) => ["https://takes.mint"]);
  (AcceptedMintsContext as unknown as { value: unknown }).value = accepted;

  App({ balance: 10 });
  await vi.waitFor(() => expect(state.payWithNWC).toHaveBeenCalled());
  expect(accepted).toHaveBeenCalledWith(100);
  expect(state.payWithNWC.mock.calls[0].slice(0, 2)).toEqual([100, "https://takes.mint"]);
});
