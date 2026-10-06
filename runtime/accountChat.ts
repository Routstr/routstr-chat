import { createAttachments } from "@/features/chat/attachments";
import type { OtherDevices } from "@/features/keys/backup";
import { exportedKeysFor } from "@/features/keys/exported";
import { oldCredit } from "@/features/keys/legacy";
import { keysFor } from "@/features/keys/service";
import { createFileStore } from "@/platform/files";
import type { AccountChatView } from "@/features/chat/view";
import { createAccountChat, type AccountChat } from "./chat";
import { node } from "./node";
import { activeHistory } from "./nostr";
import type { Sdk } from "@/features/payments/ports";
import { purseFor } from "./wallet";

/* The account in use's chat: built next to its keys, put away when another
   account takes over. */

// main's key; "x-cashu" pays each reply with a token, anything else with API keys
const SPEND_MODE = "spendMode";

type ActiveChat = AccountChat & Pick<AccountChatView, "files">;

let current: {
  owner: string;
  history: ReturnType<typeof activeHistory.get>;
  chat: ActiveChat;
} | null = null;
const listeners = new Set<() => void>();

/** Builds the chat of `owner` (or none), and puts the previous one away. */
export function startChat(
  owner: string | null,
  sdk: Sdk,
  otherDevices?: OtherDevices
) {
  // the same key added twice is two accounts, each with its own history
  const history = activeHistory.get();
  if (current?.owner === owner && current.history === history) return;
  current?.chat.dispose();
  current =
    owner && history && otherDevices
      ? { owner, history, chat: build(owner, history, sdk, otherDevices) }
      : null;
  listeners.forEach((listener) => listener());
}

function build(
  owner: string,
  history: NonNullable<ReturnType<typeof activeHistory.get>>,
  sdk: Sdk,
  otherDevices: OtherDevices
): ActiveChat {
  const files = createFileStore({
    keys: () => history.readingKeys(),
    settings: window.localStorage,
  });
  return {
    ...createAccountChat({
      owner,
      storage: window.localStorage,
      history,
      attachments: createAttachments(files),
      keys: keysFor(owner),
      purse: purseFor(owner),
      sdk,
      spending: () => ({
        mode:
          window.localStorage.getItem(SPEND_MODE)?.replace(/"/g, "") ===
          "x-cashu"
            ? "xcashu"
            : "apikeys",
        node: node.paysFor(owner) ?? undefined,
      }),
      oldCredit: oldCredit(() => node.paysFor(owner)?.url),
      otherDevices,
      adopt: (token, baseUrl) => exportedKeysFor(owner).adopt(token, baseUrl),
    }),
    files,
  };
}

export const activeChat = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (): ActiveChat | null => current?.chat ?? null,
};
