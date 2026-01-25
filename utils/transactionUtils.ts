import { PendingTransaction } from "@/features/wallet/state/transactionHistoryStore";

interface PendingTransactionInput {
  direction: PendingTransaction["direction"];
  amount: number | string;
  mintUrl: string;
  quoteId: string;
  paymentRequest: string;
  id?: string;
  timestamp?: number;
}

export const createPendingTransaction = (
  input: PendingTransactionInput
): PendingTransaction => {
  const id = input.id ?? crypto.randomUUID();
  const amount =
    typeof input.amount === "number" ? input.amount.toString() : input.amount;

  return {
    id,
    direction: input.direction,
    amount,
    timestamp: input.timestamp ?? Math.floor(Date.now() / 1000),
    status: "pending",
    mintUrl: input.mintUrl,
    quoteId: input.quoteId,
    paymentRequest: input.paymentRequest,
  };
};
