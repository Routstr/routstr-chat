import { create } from "zustand";
import type { UnclaimedToken, WaitingToken } from "@/features/book/tokens";

export type { UnclaimedToken, WaitingToken };

/** The active account's send tokens nobody has claimed yet, and received
 *  tokens still waiting for their mint. A view of its token and receive
 *  records in the wallet book, kept in step by the runtime. */
export const useUnclaimedTokensStore = create<{
  unclaimedTokens: UnclaimedToken[];
  waitingTokens: WaitingToken[];
}>()(() => ({ unclaimedTokens: [], waitingTokens: [] }));
