import { useCallback, useMemo, useRef, useState } from "react";
import { Message } from "@/types/chat";
import {
  getTextFromContent,
  stripImageDataFromSingleMessage,
} from "@/utils/messageUtils";
import { loadSatsSpentMap, saveSatsSpent } from "@/utils/storageUtils";
import { ROOT_ID } from "@/features/history/codec";
import { useHistory, useThread } from "@/features/history/view";

/* A bridge for the old chat engine (useChatActions): the chats themselves
   live in features/history. It goes with useChatActions when the
   fresh chat pipeline replaces it. `messages` is the branch on screen, so an
   index into it is a depth in the thread, with what each reply cost and,
   after it, the last request's notes (an error, "Generation stopped."):
   those are not history, they stay here for the screens to show. */

export interface UseConversationStateReturn {
  activeConversationId: string | null;
  messages: Message[];
  editingMessageIndex: number | null;
  editingContent: string;
  setMessages: (messages: Message[]) => void;
  setEditingMessageIndex: (index: number | null) => void;
  setEditingContent: (content: string) => void;
  startNewConversation: () => void;
  loadConversation: (conversationId: string) => void;
  clearConversations: () => void;
  startEditingMessage: (index: number) => void;
  cancelEditing: () => void;
  getActiveConversationId: () => string | null;
  getLastNonSystemMessageEventId: (
    conversationId: string,
    lastMessageRole?: string[]
  ) => string;
  updateLastMessageSatsSpent: (
    conversationId: string,
    satsSpent: number
  ) => void;
  /** What each reply cost, by event id (main's sats_spent_by_event). */
  replyCosts: Record<string, number>;
  createAndStoreChatEvent: (
    conversationId: string,
    message: Message
  ) => Promise<string | null>;
}

// main gave up on a save after 5 s; a signer that never answers must not
// hold the composer forever
const SAVE_WAIT_MS = 10_000;

export const useConversationState = (): UseConversationStateReturn => {
  const history = useHistory();
  // the old engine keeps callbacks from its first render (edit, retry)
  const historyRef = useRef(history);
  historyRef.current = history;
  // the reply a cost belongs to, whatever version is shown when it lands
  const lastReply = useRef(new Map<string, string>());
  const [activeConversationId, setActive] = useState<string | null>(null);
  const activeRef = useRef(activeConversationId);
  activeRef.current = activeConversationId;
  const thread = useThread(activeConversationId);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(
    null
  );
  const [editingContent, setEditingContent] = useState("");
  const [requestNotes, setRequestNotes] = useState<Record<string, Message[]>>(
    {}
  );
  const [replyCosts, setReplyCosts] = useState(loadSatsSpentMap);
  const messages = useMemo<Message[]>(
    () => [
      ...(thread ?? []).map(({ displayed: m }) =>
        replyCosts[m._eventId] === undefined
          ? m
          : { ...m, satsSpent: replyCosts[m._eventId] }
      ),
      ...((activeConversationId && requestNotes[activeConversationId]) || []),
    ],
    [thread, replyCosts, requestNotes, activeConversationId]
  );

  const open = useCallback((conversationId: string | null) => {
    activeRef.current = conversationId;
    setActive(conversationId);
    setEditingMessageIndex(null);
    setEditingContent("");
  }, []);

  const createAndStoreChatEvent = useCallback(
    async (conversationId: string, message: Message) => {
      const history = historyRef.current;
      // errors and "stopped" notes are the request's, not the chat's
      const note = (message: Message) =>
        setRequestNotes((n) => ({
          ...n,
          [conversationId]: [...(n[conversationId] ?? []), message],
        }));
      const clearNotes = () =>
        setRequestNotes((n) =>
          n[conversationId] ? { ...n, [conversationId]: [] } : n
        );
      if (!history) return null;
      if (message.role === "system") return (note(message), null);
      clearNotes();
      // a request that saves no reply has no cost to stamp
      lastReply.current.delete(conversationId);
      // a new chat opens, so a note about it shows; a reply never pulls you back
      if (!history.getThread(conversationId) && activeRef.current === null) {
        open(conversationId);
      }
      const saving = history.save(conversationId, {
        ...stripImageDataFromSingleMessage(message),
        _prevId: message._prevId ?? ROOT_ID,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const saved = await Promise.race([
          saving,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("the signer did not answer")),
              SAVE_WAIT_MS
            );
          }),
        ]).finally(() => clearTimeout(timer));
        if (saved.role === "assistant") {
          lastReply.current.set(conversationId, saved._eventId);
        }
        return saved._eventId;
      } catch (error) {
        note({
          role: "system",
          content: `This message could not be saved: ${error instanceof Error ? error.message : error}`,
        });
        // a slow signer may still finish it: then the note is wrong
        saving.then(clearNotes, () => {});
        return null;
      }
    },
    [open]
  );

  return {
    activeConversationId,
    messages,
    editingMessageIndex,
    editingContent,
    setMessages: () => {},
    setEditingMessageIndex,
    setEditingContent,
    startNewConversation: () => open(null),
    loadConversation: open,
    clearConversations: () => {
      open(null);
      history?.forgetHere().catch((error) => console.error(error));
    },
    startEditingMessage: (index) => {
      setEditingMessageIndex(index);
      setEditingContent(messages[index] ? getTextFromContent(messages[index].content) : "");
    },
    cancelEditing: () => {
      setEditingMessageIndex(null);
      setEditingContent("");
    },
    getActiveConversationId: () => activeRef.current,
    getLastNonSystemMessageEventId: (conversationId, roles) => {
      const last = (historyRef.current?.branch(conversationId) ?? [])
        .filter((m) => !roles?.length || roles.includes(m.role))
        .at(-1);
      return last?._eventId ?? ROOT_ID;
    },
    updateLastMessageSatsSpent: (conversationId, satsSpent) => {
      const reply = lastReply.current.get(conversationId);
      if (!reply) return;
      saveSatsSpent(reply, satsSpent);
      setReplyCosts((costs) => ({ ...costs, [reply]: satsSpent }));
    },
    replyCosts,
    createAndStoreChatEvent,
  };
};
