import { create } from "zustand";
import type { UnclaimedToken } from "@/features/book/tokens";

export type { UnclaimedToken };

/** The active account's send tokens nobody has claimed yet. A view of its
 *  token records in the wallet book, kept in step by the runtime. */
export const useUnclaimedTokensStore = create<{
  unclaimedTokens: UnclaimedToken[];
}>()(() => ({ unclaimedTokens: [] }));
