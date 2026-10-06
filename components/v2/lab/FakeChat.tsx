"use client";

/* Development only. A stand-in for ChatProvider so the real v2 components can
   be driven through every state (streaming, reasoning, errors, versions,
   pictures) without spending sats. Nothing here ships: app/lab renders only
   in development. */

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatContext } from "@/context/ChatProvider";
import { HistoryContext, type HistoryService } from "@/features/history/view";
import type { Conversation, Message, MessageAttachment } from "@/types/chat";
import type { Model } from "@/types/models";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { CatalogStandInContext } from "../picker/useCatalog";
import { LAB_MODELS, PICKS, labRoutes } from "./catalog";

const now = Date.now();
const H = 3_600_000;
const D = 24 * H;

export const MODELS: Model[] = LAB_MODELS;

const ANSWER_1 = `A **Cashu mint** is a server that issues ecash: signed tokens that stand in for sats, which you hold on your own device. It can see that a token is valid when you spend it, but not which issuance it came from.`;

const ANSWER_2 = `## Blind signatures, briefly

A blind signature lets the mint sign a token it never sees. Your wallet picks a random secret, maps it to a point on the curve, then hides it behind a blinding factor. The mint signs that blinded point and hands it back; your wallet strips the factor off, leaving a valid signature on the untouched secret.

\`\`\`python
# BDHKE, the blind signature scheme Cashu uses
Y  = hash_to_curve(secret)      # the secret as a curve point
r  = random_scalar()            # blinding factor, never leaves you
B_ = Y + r * G                  # blinded point, all the mint sees

C_ = k * B_                     # the mint signs with its key k
C  = C_ - r * K                 # unblind, since K = k * G
assert C == k * Y               # a signature on the plain secret
mint.verify(secret, C)          # at spend time it checks its own key
\`\`\`

When you spend that token, the mint checks its own key over a secret it has never seen, so it cannot link the spend to the moment the token was made.

| Step | Who sees what |
|---|---|
| Blinding | only you know \`r\` |
| Signing | the mint sees \`B_\`, not \`Y\` |
| Spending | the mint sees \`Y\` and \`C\`, not the link |

The math is the Diffie-Hellman equality $C = kY$, checked without ever learning how $Y$ was hidden.[1]`;

const THINKING = `**Clarifying the scheme**
The user wants ecash blinding explained and then shown in Python. Cashu uses BDHKE (blind Diffie-Hellman key exchange), not RSA blind signatures, so the example should use curve points.

**Planning the example**
Show hash_to_curve, the blinding factor r, the mint's signature C_ = k*B_, and the unblinding C = C_ - r*K. Keep it to about ten lines with comments aligned in a column.

**Checking the claim**
Unlinkability comes from r being uniformly random: B_ reveals nothing about Y. Worth a one-line table on who sees what.`;

const STREAM_3 = `Good question. The **blinding factor** is what makes the mint's view useless for tracking.

1. Your wallet picks \`r\` fresh for every token, uniformly at random.
2. \`B_ = Y + rG\` is then a uniformly random point too, whatever \`Y\` is.
3. So when the mint later sees \`Y\` at spend time, there is nothing to match it against.

In short: the mint signs a point that looks like noise, and noise has no fingerprint. If you reuse \`r\`, or derive it badly, that guarantee is gone, which is why wallets derive it from a seed with a counter.`;

const IMG = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><radialGradient id="g" cx="30%" cy="25%" r="85%"><stop offset="0" stop-color="#f4d9a8"/><stop offset=".45" stop-color="#c7735a"/><stop offset="1" stop-color="#2b1d33"/></radialGradient></defs><rect width="800" height="800" fill="url(#g)"/><circle cx="560" cy="250" r="90" fill="#fff4dd" opacity=".85"/><path d="M0 610 C180 540 320 660 520 590 S760 560 800 580 V800 H0Z" fill="#1d1426" opacity=".9"/></svg>`)}`;

const msg = (role: string, content: Message["content"], t: number, extra: Partial<Message> = {}): Message => ({
  role,
  content,
  _createdAt: t,
  _eventId: `${role}-${t}`,
  ...extra,
});

function seed(): Conversation[] {
  const c1: Message[] = [
    msg("user", "What is a Cashu mint?", now - 2 * H),
    msg("assistant", "A mint is a server that issues ecash tokens.", now - 2 * H + 5000, { _modelId: "openai/gpt-5", satsSpent: 9, _prevId: "user-" + (now - 2 * H) }),
    msg("assistant", ANSWER_1, now - 2 * H + 60000, { _modelId: "anthropic/claude-sonnet-5", satsSpent: 12, _prevId: "user-" + (now - 2 * H) }),
    msg("user", "Explain how ecash blinding works, then show it in Python.", now - H, { _prevId: "assistant-" + (now - 2 * H + 60000) }),
    msg(
      "assistant",
      [{ type: "text", text: ANSWER_2, thinking: THINKING, citations: ["https://cashu.space/docs/bdhke?utm_source=x"] }],
      now - H + 9000,
      { _modelId: "anthropic/claude-sonnet-5", satsSpent: 31, _prevId: "user-" + (now - H) }
    ),
  ];
  const c2: Message[] = [
    msg("user", "Paint a warm dusk over a quiet harbour", now - 3 * D),
    msg("assistant", [{ type: "text", text: "Here is a quiet harbour at dusk." }, { type: "image_url", image_url: { url: IMG } }], now - 3 * D + 20000, { _modelId: "openai/gpt-image-2", satsSpent: 140 }),
  ];
  const c3: Message[] = [
    msg("user", "Summarise the attached grant draft", now - 26 * H),
    msg("system", "The provider did not respond to this request.", now - 26 * H + 30000),
    msg("system", "The provider did not respond to this request.", now - 26 * H + 60000),
  ];
  const titles: [string, number][] = [
    ["Rust lifetimes in async traits", now - 5 * H],
    ["Trip plan: Lisbon in October", now - 30 * H],
    ["Why my Lightning channel is stuck in pending close after the peer went offline", now - 7 * H],
    ["Compare Lightning wallets for travel", now - 3 * D],
    ["SQL window functions", now - 4 * D],
    ["Nostr relay tuning", now - 12 * D],
    ["Sourdough hydration math", now - 40 * D],
  ];
  return [
    { id: "c1", title: "Ecash blinding explained", messages: c1 },
    ...titles.slice(0, 1).map(([t, at], i) => ({ id: `x${i}`, title: t, messages: [msg("user", t, at), msg("assistant", `Notes on ${t.toLowerCase()}.`, at + 4000, { _modelId: "deepseek/deepseek-v3.2", satsSpent: 3 })] })),
    { id: "c3", title: "Draft: grant proposal intro", messages: c3 },
    { id: "c2", title: "Harbour at dusk", messages: c2 },
    ...titles.slice(1).map(([t, at], i) => ({ id: `y${i}`, title: t, messages: [msg("user", t, at), msg("assistant", `Notes on ${t.toLowerCase()}.`, at + 4000, { _modelId: "openai/gpt-5", satsSpent: 6 })] })),
  ];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The lab's chats behind the history view; app/lab builds it (labHistory.ts). */
export type FakeHistory = HistoryService & { update(chats: Conversation[], syncing: boolean): void };
export interface FakeHistoryHooks {
  remove(id: string): void;
  sync(): Promise<void>;
}

export function FakeChatProvider({ children, history }: { children: React.ReactNode; history: (hooks: FakeHistoryHooks) => FakeHistory }) {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>(() => (params.get("fresh") ? [] : seed()));
  const [activeId, setActiveId] = useState<string | null>(() => (params.get("fresh") ? null : params.get("chat") ?? "c1"));
  const [messages, setMessagesState] = useState<Message[]>(() => (params.get("fresh") ? [] : (seed().find((c) => c.id === (params.get("chat") ?? "c1"))?.messages ?? [])));
  const [inputMessage, setInputMessage] = useState("");
  // Sync in the lab: busy for a moment, and one chat arrives from "another device"
  const [syncing, setSyncing] = useState(false);
  const syncNow = useCallback(async () => {
    setSyncing(true);
    await sleep(1600);
    setConversations((cs) =>
      cs.some((c) => c.id === "c10")
        ? cs
        : [
            {
              id: "c10",
              title: "Walking routes in Porto",
              messages: [
                msg("user", "A two hour walk in Porto that ends somewhere with a view.", Date.now() - 20 * 60000),
                msg("assistant", "Start at the cathedral, drop down the Ribeira steps to the river, cross the top deck of the Dom Luís bridge and finish at the Serra do Pilar viewpoint.", Date.now() - 19 * 60000, { _modelId: "google/gemini-3-pro", satsSpent: 6 }),
              ],
            } as Conversation,
            ...cs,
          ]
    );
    setSyncing(false);
  }, []);
  // the screens read chats from history: the lab's chats stand behind it
  const [lab] = useState(() => history({ remove: (id) => setConversations((cs) => cs.filter((c) => c.id !== id)), sync: syncNow }));
  useLayoutEffect(() => lab.update(conversations, syncing), [lab, conversations, syncing]);
  // what the real bridge hands the screens: the branch shown, then the last request's notes
  const slots = useSyncExternalStore(lab.subscribe, () => (activeId ? lab.getThread(activeId) : undefined), () => undefined);
  const shown = useMemo(() => {
    const branch = slots?.map((s) => s.displayed) ?? [];
    const after = branch.at(-1)?._createdAt ?? 0;
    return [...branch, ...messages.filter((m) => m.role === "system" && (m._createdAt ?? 0) > after)];
  }, [slots, messages]);
  const [uploadedAttachments, setUploadedAttachments] = useState<MessageAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const [stream, setStream] = useState("");
  const [thinking, setThinking] = useState("");
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<Model | null>(() => MODELS.find((m) => m.id === "anthropic/claude-sonnet-5") ?? null);
  const [currentKey, setCurrentKey] = useState<string | null>("anthropic/claude-sonnet-5");
  const loadingModels = !!params.get("loading");
  const [configuredModels, setConfiguredModels] = useState<string[]>(["anthropic/claude-sonnet-5", "openai/gpt-5", "deepseek/deepseek-v3.2@@https://api.nonkycai.com/"]);
  const [balance, setBalance] = useState(() => Number(params.get("balance") ?? 2140));
  const [collapsed, setCollapsed] = useState(false);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const abort = useRef(false);
  const convRef = useRef(activeId);
  convRef.current = activeId;

  const setMessages = useCallback((m: Message[]) => {
    setMessagesState(m);
    setConversations((cs) => cs.map((c) => (c.id === convRef.current ? { ...c, messages: m } : c)));
  }, []);

  const run = useCallback(
    async (base: Message[], convId: string, prevId?: string) => {
      abort.current = false;
      setIsLoading(true);
      setStreamingConversationId(convId);
      setIsPaymentProcessing(true);
      await sleep(700);
      if (params.get("fail")) {
        setIsPaymentProcessing(false);
        await sleep(2400);
        const err = msg("system", "The provider did not respond to this request.", Date.now(), { _prevId: prevId });
        setMessages([...base, err]);
        setIsLoading(false);
        setStreamingConversationId(null);
        return;
      }
      await sleep(1600);
      setIsPaymentProcessing(false);
      const reasons = !params.get("nothink");
      if (reasons) {
        const words = THINKING.split(/(\s+)/);
        let acc = "";
        for (let i = 0; i < words.length && !abort.current; i += 3) {
          acc += words.slice(i, i + 3).join("");
          setThinking(acc);
          await sleep(40 + Math.random() * 40);
        }
      }
      const answer = base.length > 3 ? STREAM_3 : ANSWER_2;
      let acc = "";
      const parts = answer.split(/(\s+)/);
      for (let i = 0; i < parts.length && !abort.current; ) {
        // bursty: the network hands over a few words, then pauses
        const n = 2 + Math.floor(Math.random() * 10);
        acc += parts.slice(i, i + n).join("");
        i += n;
        setStream(acc);
        await sleep(40 + Math.random() * 160);
      }
      const final = msg("assistant", acc, Date.now(), {
        _modelId: selectedModel?.id,
        satsSpent: 18 + Math.round(Math.random() * 20),
        _prevId: prevId,
      });
      // as the real app: a stop keeps the words that came, and only those
      const stopped = msg("system", "Generation stopped.", Date.now() + 1);
      const out = !abort.current ? [...base, final] : acc.trim() ? [...base, final, stopped] : [...base, stopped];
      setMessages(out);
      setIsLoading(false);
      setStream("");
      setThinking("");
      setStreamingConversationId(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setMessages, selectedModel]
  );

  const value = useMemo(() => {
    const base = {
      activeConversationId: activeId,
      messages: shown,
      setMessages,
      editingMessageIndex,
      editingContent,
      setEditingContent,
      setEditingMessageIndex,
      startEditingMessage: (i: number) => {
        setEditingMessageIndex(i);
        const m = shown[i];
        setEditingContent(typeof m.content === "string" ? m.content : m.content.find((c) => c.type === "text")?.text ?? "");
      },
      cancelEditing: () => {
        setEditingMessageIndex(null);
        setEditingContent("");
      },
      startNewConversation: () => {
        setActiveId(null);
        setMessagesState([]);
      },
      loadConversation: (id: string) => {
        setActiveId(id);
        setMessagesState(conversations.find((c) => c.id === id)?.messages ?? []);
      },
      clearConversations: () => setConversations([]),
      getActiveConversationId: () => convRef.current,
      models: loadingModels ? [] : MODELS,
      selectedModel,
      setSelectedModel,
      isLoadingModels: loadingModels,
      hasPickedModel: !loadingModels,
      fetchModels: async () => {},
      handleModelChange: (id: string, key?: string) => {
        const m = MODELS.find((x) => x.id === id);
        if (!m) return;
        setSelectedModel(m);
        setCurrentKey(key ?? id);
      },
      lowBalanceWarningForModel: balance <= 0,
      isSettingsOpen: false,
      setIsSettingsOpen: () => {},
      isLoginModalOpen,
      setIsLoginModalOpen,
      isSidebarCollapsed: collapsed,
      setIsSidebarCollapsed: setCollapsed,
      isSidebarOpen: false,
      setIsSidebarOpen: () => {},
      isMobile: false,
      configuredModels,
      setConfiguredModels,
      toggleConfiguredModel: (k: string) => setConfiguredModels((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k])),
      modelProviderMap: {},
      setModelProviderFor: () => {},
      inputMessage,
      setInputMessage,
      uploadedAttachments,
      setUploadedAttachments,
      isLoading,
      setIsLoading,
      isPaymentProcessing,
      streamingConversationId,
      getStreamingContentFor: (id: string | null) => (id === streamingConversationId ? stream : ""),
      getThinkingContentFor: (id: string | null) => (id === streamingConversationId ? thinking : ""),
      streamingContent: stream,
      thinkingContent: thinking,
      balance,
      setBalance,
      isBalanceLoading: false,
      isWalletLoading: false,
      currentMintUnit: "sat",
      // the lab's sats sit on the default mint, so Send has something to spend
      mintBalances: { [DEFAULT_MINT_URL]: balance },
      mintUnits: { [DEFAULT_MINT_URL]: "sat" },
      transactionHistory: [],
      setTransactionHistory: () => {},
      messagesEndRef: { current: null },
      stopGeneration: () => {
        abort.current = true;
      },
      returnHeld: async () => {},
      refundAllApiKeys: async () => ({ totalRefunded: 0, totalFailed: 0, results: [] }),
      sendMessage: async () => {
        if (!inputMessage.trim()) return;
        let convId = activeId;
        if (!convId) {
          convId = `n${Date.now()}`;
          const title = inputMessage.slice(0, 48);
          setConversations((cs) => [{ id: convId!, title, messages: [] }, ...cs]);
          setActiveId(convId);
          convRef.current = convId;
        }
        const last = [...shown].reverse().find((m) => m.role !== "system");
        const user = msg("user", inputMessage, Date.now(), { _prevId: last?._eventId });
        const next = [...messages, user];
        setInputMessage("");
        setUploadedAttachments([]);
        setMessages(next);
        void run(next, convId, user._eventId);
      },
      retryMessage: (index: number) => {
        const target = shown[index];
        const base = shown.slice(0, index);
        setMessages(base);
        void run(base, activeId ?? "c1", target?._prevId);
      },
      saveInlineEdit: async () => {
        if (editingMessageIndex === null) return;
        const old = shown[editingMessageIndex];
        const edited = msg("user", editingContent, Date.now(), { _prevId: old._prevId });
        const base = [...shown.slice(0, editingMessageIndex + 1), edited];
        setEditingMessageIndex(null);
        setEditingContent("");
        setMessages(base);
        void run(base, activeId ?? "c1", edited._eventId);
      },
    };
    return new Proxy(base, {
      get(t, k: string) {
        if (k in t) return (t as Record<string, unknown>)[k];
        return () => undefined;
      },
    });
  }, [conversations, activeId, shown, setMessages, editingMessageIndex, editingContent, selectedModel, balance, isLoginModalOpen, collapsed, configuredModels, inputMessage, uploadedAttachments, isLoading, isPaymentProcessing, streamingConversationId, stream, thinking, run, syncing, syncNow]);

  const standIn = useMemo(() => ({ routes: labRoutes, picks: PICKS, currentKey }), [currentKey]);
  return (
    <ChatContext.Provider value={value as never}>
      <HistoryContext.Provider value={lab}>
        <CatalogStandInContext.Provider value={standIn}>{children}</CatalogStandInContext.Provider>
      </HistoryContext.Provider>
    </ChatContext.Provider>
  );
}
