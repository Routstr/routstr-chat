import { createAttachments } from "@/features/chat/attachments";
import type { OtherDevices } from "@/features/keys/backup";
import { exportedKeysFor } from "@/features/keys/exported";
import { oldCredit } from "@/features/keys/legacy";
import { keysFor } from "@/features/keys/service";
import { createFileStore } from "@/platform/files";
import { createAccountChat, type AccountChat } from "./chat";
import { node } from "./node";
import { activeHistory } from "./nostr";
import type { Sdk } from "@/features/payments/ports";
import { purseFor } from "./wallet";

/* The account in use's chat: built next to its keys, put away when another
   account takes over. */

// main's key; "x-cashu" pays each reply with a token, anything else with API keys
const SPEND_MODE = "spendMode";

let current: {
  owner: string;
  history: ReturnType<typeof activeHistory.get>;
  chat: AccountChat;
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
      ? {
          owner,
          history,
          chat: createAccountChat({
            owner,
            storage: window.localStorage,
            history,
            attachments: createAttachments(
              createFileStore({
                keys: () => history.readingKeys(),
                settings: window.localStorage,
              })
            ),
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
            adopt: (token, baseUrl) =>
              exportedKeysFor(owner).adopt(token, baseUrl),
          }),
        }
      : null;
  listeners.forEach((listener) => listener());
}

export const activeChat = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (): AccountChat | null => current?.chat ?? null,
};
