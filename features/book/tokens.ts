import type { BookRecord } from "./records";

/** A send token nobody has claimed yet, as the wallet screens list it. */
export interface UnclaimedToken {
  id: string;
  token: string;
  amount: number;
  unit: string;
  mintUrl: string;
  createdAt: number;
}

/** The token records among an account's records, newest first. */
export const tokensOf = (records: BookRecord[]): UnclaimedToken[] =>
  records
    .flatMap((r) =>
      r.kind === "token"
        ? [
            {
              id: r.id,
              token: r.token,
              amount: r.amount,
              unit: r.unit,
              mintUrl: r.mintUrl,
              createdAt: r.createdAt,
            },
          ]
        : []
    )
    .sort((a, b) => b.createdAt - a.createdAt);
