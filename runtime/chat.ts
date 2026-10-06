import { ReplyCosts } from "@/features/chat/costs";
import type { Attachments, ChatHistory } from "@/features/chat/ports";
import { ChatService } from "@/features/chat/service";
import type { AccountChatView } from "@/features/chat/view";
import { AutoRefund } from "@/features/payments/autoRefund";
import { heldSats } from "@/features/payments/held";
import type {
  Keys,
  OldCredit,
  OtherDevices,
  Purse,
  Sdk,
  Spending,
} from "@/features/payments/ports";
import { refundCredit } from "@/features/payments/refund";
import { createPay } from "@/features/payments/request";
import { owned } from "@/features/session/owned";

interface AccountChatDeps {
  owner: string;
  /** Where reply costs are kept (localStorage). */
  storage: Pick<Storage, "getItem" | "setItem">;
  history: ChatHistory;
  attachments: Attachments;
  keys: Keys & { subscribeCredit(listener: () => void): () => void };
  /** Built for this account only. */
  purse: Purse;
  sdk: Sdk;
  spending(): Spending;
  oldCredit: OldCredit;
  otherDevices: OtherDevices;
}

/** Chat and its payments for one account, for as long as it is the one in use. */
export interface AccountChat extends AccountChatView {
  /** Stops new work. Turns already paying settle into this account. */
  dispose(): void;
}

export function createAccountChat(deps: AccountChatDeps): AccountChat {
  let live = true;
  const payments = { ...deps, live: () => live };
  // the same owned key the old screens read, in main's format
  const costs = new ReplyCosts(
    deps.storage,
    owned("sats_spent_by_event", deps.owner),
    deps.sdk.cost
  );
  const chat = new ChatService({
    history: deps.history,
    attachments: deps.attachments,
    pay: createPay(payments),
    costs,
  });
  // main's old shared credit, read from disk at the start and after each
  // refund (a sweep writes it through its own copy)
  let oldHeld = 0;
  const heldListeners = new Set<() => void>();
  const readOld = () =>
    deps.oldCredit.load().then(
      (old) => {
        oldHeld = heldSats(old);
        heldListeners.forEach((listener) => listener());
      },
      (error) => console.warn("Could not read the old credit", error)
    );
  void readOld();
  const refund = (force: boolean) =>
    refundCredit(payments, force).finally(readOld);
  const auto = new AutoRefund(() => refund(false));
  const unfollow = chat.subscribe(() => auto.activity(chat.busy()));
  auto.start();
  return {
    chat,
    costs,
    refund: () => refund(true),
    held: {
      subscribe(listener) {
        heldListeners.add(listener);
        const unsubscribe = deps.keys.subscribeCredit(listener);
        return () => {
          heldListeners.delete(listener);
          unsubscribe();
        };
      },
      get: () => heldSats(deps.keys.storage("direct")) + oldHeld,
    },
    viewing: (conversationId) => auto.viewing(conversationId),
    dispose() {
      live = false;
      unfollow();
      auto.dispose();
      chat.dispose();
    },
  };
}
