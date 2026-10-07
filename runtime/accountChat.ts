import { createAttachments, filesIn } from "@/features/chat/attachments";
import { owned } from "@/features/session/owned";
import type { OtherDevices } from "@/features/keys/backup";
import { exportedKeysFor } from "@/features/keys/exported";
import { oldCredit } from "@/features/keys/legacy";
import { keysFor } from "@/features/keys/service";
import { createFileStore } from "@/platform/files";
import { mainStoreDriver } from "@/platform/sdk";
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

/** payments' `redeem` until the wallet's own lands (merged with v2/ui): a
 *  token the credit keeps is never taken back after a failed reply, so the
 *  SDK keeps its key and the next refund brings it home. */
const notRedeemed = async (): Promise<number> => {
  throw Object.assign(new Error("Left for the next refund"), {
    reason: "unreachable",
  });
};

type ActiveChat = AccountChat & Pick<AccountChatView, "files">;

let current: {
  owner: string;
  history: ReturnType<typeof activeHistory.get>;
  chat: ActiveChat;
} | null = null;
const listeners = new Set<() => void>();
// main's old store, opened once per tab and shared by every account
let mainOld: ReturnType<typeof mainStoreDriver> | undefined;
const mainStore = () => (mainOld ??= mainStoreDriver());

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
    owner,
    keys: () => history.readingKeys(),
    settings: window.localStorage,
  });
  cleanUpDaily(owner, history, files);
  return {
    ...createAccountChat({
      owner,
      storage: window.localStorage,
      history,
      attachments: createAttachments(files),
      keys: keysFor(owner),
      purse: { ...purseFor(owner), redeem: notRedeemed },
      sdk,
      spending: () => ({
        mode:
          window.localStorage.getItem(SPEND_MODE)?.replace(/"/g, "") ===
          "x-cashu"
            ? "xcashu"
            : "apikeys",
        node: node.paysFor(owner) ?? undefined,
      }),
      oldCredit: oldCredit(() => node.paysFor(owner)?.url, mainStore()),
      otherDevices,
      adopt: (token, baseUrl) => exportedKeysFor(owner).adopt(token, baseUrl),
    }),
    files,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The files layer's weekly cleanup, once a day per account, in the
 *  background once the account's history is all in: it decides by the
 *  messages. */
function cleanUpDaily(
  owner: string,
  history: NonNullable<ReturnType<typeof activeHistory.get>>,
  files: AccountChatView["files"]
) {
  const key = owned("files_cleaned_at", owner);
  try {
    if (Date.now() - Number(window.localStorage.getItem(key)) < DAY_MS) return;
  } catch {
    return; // storage blocked: no way to keep it to once a day
  }
  // only once every message is here: a file no loaded message uses goes
  void history.complete.then((all) => {
    if (!all) return;
    try {
      window.localStorage.setItem(key, String(Date.now()));
    } catch {
      // storage full: it runs again next time
    }
    const used = filesIn(history.getConversations().flatMap((c) => c.messages));
    files
      .cleanup(used)
      .catch((error) => console.warn("Could not clean up old files", error));
  });
}

export const activeChat = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: (): ActiveChat | null => current?.chat ?? null,
};
