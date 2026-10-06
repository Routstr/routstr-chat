import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useChat } from "@/context/ChatProvider";
import { useCatalogService } from "@/features/catalog/view";
import { useHistory } from "@/features/history/view";
import { editedOf, questionOf, useAccountChat, type AccountChatView, type ChatModel } from "@/features/chat/view";
import { chatModelOf, useChatModel } from "./useChatModel";
import { useDraft, useUi } from "./ui";

type Chat = AccountChatView["chat"];

/* Send, retry and edit through the signed-in account's chat. Signed out, the
   composer turns to sign in. A turn that cannot start says why, and what you
   wrote stays in the box. */
export function useActions() {
  const account = useAccountChat();
  const history = useHistory();
  const catalog = useCatalogService();
  const { model, chosen } = useChatModel();
  const { activeConversationId, getActiveConversationId, loadConversation } = useChat();
  const draft = useDraft();
  const { setFace } = useUi();
  // a new chat has no id to claim until its question is in: a second Enter waits
  const sending = useRef(false);

  const start = useCallback(
    async (turn: (chat: Chat, model: ChatModel) => Promise<unknown>): Promise<boolean> => {
      if (!account) {
        setFace("auth");
        return false;
      }
      if (!model) {
        toast.error("No model can answer yet. Try again in a moment.");
        return false;
      }
      try {
        await turn(account.chat, chatModelOf(model, chosen, catalog?.routes(model.id) ?? []));
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [account, model, chosen, catalog, setFace]
  );

  const send = useCallback(async () => {
    const { text, attachments, rev } = draft;
    if ((!text.trim() && !attachments.length) || sending.current) return;
    const id = activeConversationId ?? String(Date.now());
    sending.current = true;
    const sent = await start((chat, m) => chat.send(id, questionOf(text, attachments), m)).finally(() => {
      sending.current = false;
    });
    if (!sent) return;
    draft.clear(rev);
    // a new chat opens once its question is in, unless you went elsewhere meanwhile
    if (getActiveConversationId() === null) loadConversation(id);
  }, [draft, activeConversationId, start, getActiveConversationId, loadConversation]);

  const retry = useCallback(
    (index: number) => {
      if (activeConversationId) void start((chat, m) => chat.retry(activeConversationId, index, m));
    },
    [activeConversationId, start]
  );

  // the edit box closes once the new version is in
  const saveEdit = useCallback(
    async (index: number, text: string, close: () => void) => {
      const question = activeConversationId ? history?.branch(activeConversationId)[index] : undefined;
      if (!activeConversationId || !question) return;
      const sent = await start((chat, m) => chat.edit(activeConversationId, index, editedOf(question.content, text), m));
      if (sent) close();
    },
    [activeConversationId, history, start]
  );

  return { send, retry, saveEdit };
}
