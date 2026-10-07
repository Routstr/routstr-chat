import type { BookRecord } from "./records";

/** A send token nobody has claimed yet, as the wallet screens list it. */
export interface UnclaimedToken {
  id: string;
  token: string;
  amount: number;
  unit: string;
  mintUrl: string;
  createdAt: number;
  /** the provider it was handed to, if any */
  baseUrl?: string;
}

/** A received token still waiting for its mint, as activity lists it. */
export interface WaitingToken {
  id: string;
  amount: number;
  unit: string;
  mintUrl: string;
  createdAt: number;
}

/** The receive records among an account's records, newest first. */
export const waitingOf = (records: BookRecord[]): WaitingToken[] =>
  records
    .flatMap((r) =>
      r.kind === "receive"
        ? [
            {
              id: r.id,
              amount: r.amount,
              unit: r.unit ?? "sat",
              mintUrl: r.mintUrl,
              createdAt: r.createdAt,
            },
          ]
        : []
    )
    .sort((a, b) => b.createdAt - a.createdAt);

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
              ...(r.baseUrl ? { baseUrl: r.baseUrl } : {}),
            },
          ]
        : []
    )
    .sort((a, b) => b.createdAt - a.createdAt);
