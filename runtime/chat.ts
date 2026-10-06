import { ReplyCosts } from "@/features/chat/costs";
import type { Attachments, ChatHistory } from "@/features/chat/ports";
import { ChatService } from "@/features/chat/service";
import type { AccountChatView } from "@/features/chat/view";
import { AutoRefund } from "@/features/payments/autoRefund";
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

export interface AccountChatDeps {
  owner: string;
  /** Where reply costs are kept (localStorage). */
  storage: Pick<Storage, "getItem" | "setItem">;
  history: ChatHistory;
  attachments: Attachments;
  keys: Keys;
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
  // main kept one unowned map; the move to its owner comes with the screens
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
  const auto = new AutoRefund(() => refundCredit(payments, false));
  const unfollow = chat.subscribe(() => auto.activity(chat.busy()));
  auto.start();
  return {
    chat,
    costs,
    refund: () => refundCredit(payments, true),
    viewing: (conversationId) => auto.viewing(conversationId),
    dispose() {
      live = false;
      unfollow();
      auto.dispose();
      chat.dispose();
    },
  };
}
