import { create } from "zustand";
import { persist } from "zustand/middleware";

// A generated eCash send token that has not been confirmed as delivered yet.
// Once a token is generated the proofs inside it are the only copy of the
// funds, so it must survive component unmounts (e.g. closing the wallet
// popover) until the user explicitly dismisses or reclaims it.
export interface UnclaimedToken {
  id: string;
  token: string;
  amount: number;
  unit: string;
  mintUrl: string;
  createdAt: number;
}

interface UnclaimedTokensStore {
  unclaimedTokens: UnclaimedToken[];

  addUnclaimedToken: (token: Omit<UnclaimedToken, "id" | "createdAt">) => void;

  removeUnclaimedToken: (id: string) => void;
}

export const useUnclaimedTokensStore = create<UnclaimedTokensStore>()(
  persist(
    (set) => ({
      unclaimedTokens: [],

      addUnclaimedToken(entry) {
        const newToken: UnclaimedToken = {
          ...entry,
          id: `unclaimed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        };
        set((state) => ({
          unclaimedTokens: [newToken, ...state.unclaimedTokens],
        }));
      },

      removeUnclaimedToken(id) {
        set((state) => ({
          unclaimedTokens: state.unclaimedTokens.filter((t) => t.id !== id),
        }));
      },
    }),
    { name: "cashu-unclaimed-tokens" }
  )
);
