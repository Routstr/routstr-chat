"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getTokenMetadata } from "@cashu/cashu-ts";
import { toast } from "sonner";
import { AuthProvider } from "@/context/AuthProvider";
import { useSession } from "@/features/session/view";
import { ChatProvider, useChat } from "@/context/ChatProvider";
import { useAccountChat, useAnswering } from "@/features/chat/view";
import { useConversations, useHistoryLoaded } from "@/features/history/view";
import { KeepAliveProvider, useKeepAliveContext } from "@/components/pwa/KeepAliveProvider";
import { QueryTimeoutModal } from "@/components/QueryTimeoutModal";
import { useCashuToken, useCashuWallet } from "@/features/wallet";
import { useAutoRefill } from "@/hooks/useAutoRefill";
import { RoomProvider } from "./room/RoomProvider";
import { UiProvider, useUi } from "./ui";
import { useEnsureAccount } from "./useEnsureAccount";
import Shell from "./Shell";
import Boot from "./Boot";
import "./styles/index.css";

/* Everything the app does that is not drawing: keep-alive while answering,
   auto-refill, the relay timeout notice, a ?cashu= link, and the chat in
   the address bar. The drawing is Shell. */
function Behaviour() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pubkey, ready: authChecked } = useSession();
  const isAuthenticated = pubkey !== null;
  const { balance, loadConversation, activeConversationId } = useChat();
  const isStreaming = useAnswering() !== null;
  const accountChat = useAccountChat();
  const conversations = useConversations();
  const conversationsLoaded = useHistoryLoaded();
  const ui = useUi();
  const { startKeepAlive, stopKeepAlive, isEnabled: keepAliveEnabled } = useKeepAliveContext();
  const {
    showQueryTimeoutModal,
    setShowQueryTimeoutModal,
    didRelaysTimeout,
    setDidRelaysTimeout,
    isLoading: isWalletLoading,
  } = useCashuWallet();
  const { receiveToken } = useCashuToken();
  const ensureAccount = useEnsureAccount();

  // keep the tab alive while an answer streams, if the person asked for it
  useEffect(() => {
    if (!keepAliveEnabled) return;
    if (isStreaming) startKeepAlive();
    else stopKeepAlive();
  }, [isStreaming, keepAliveEnabled, startKeepAlive, stopKeepAlive]);

  // only once the wallet has loaded, so a zero on boot is not mistaken for empty
  useAutoRefill({ balance, isWalletLoaded: !isWalletLoading });

  // leaving a chat hands back what providers still hold for this account
  useEffect(() => accountChat?.viewing(activeConversationId), [accountChat, activeConversationId]);

  const qs = searchParams.toString();
  const chatIdFromUrl = searchParams.get("chatId");
  const replaceQuery = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(qs);
    mutate(p);
    const next = p.toString();
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  };

  // ?tab=apikeys opens settings where the keys live
  const tab = searchParams.get("tab");
  useEffect(() => {
    if (tab !== "apikeys" || !isAuthenticated) return;
    ui.openSettings("keys");
    replaceQuery((p) => p.delete("tab"));
  }, [tab, isAuthenticated]);

  // ?cashu=<token>: redeem it once, on arrival, then take it out of the address
  const cashuParam = searchParams.get("cashu");
  const redeemed = useRef<string | null>(null);
  useEffect(() => {
    if (!authChecked || !cashuParam || redeemed.current === cashuParam) return;
    // an existing wallet must finish loading before new proofs join it
    if (isAuthenticated && isWalletLoading) return;
    redeemed.current = cashuParam;
    const token = cashuParam.trim();
    (async () => {
      try {
        const { unit, amount } = getTokenMetadata(token);
        const sats = unit === "msat" ? Math.floor(amount / 1000) : amount;
        ensureAccount();
        await receiveToken(token);
        toast.success(`${sats.toLocaleString()} sats received`);
        replaceQuery((p) => p.delete("cashu"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "That token could not be received");
      }
    })();
  }, [authChecked, cashuParam, isAuthenticated, isWalletLoading]);

  // the open chat lives in the address bar, both ways
  const pendingUrlSync = useRef(false);
  const prevActive = useRef<string | null>(null);
  useEffect(() => {
    const previous = prevActive.current;
    prevActive.current = activeConversationId;
    if (!activeConversationId) {
      if (chatIdFromUrl && previous) {
        pendingUrlSync.current = true;
        replaceQuery((p) => p.delete("chatId"));
      }
      return;
    }
    if (chatIdFromUrl === activeConversationId) return;
    pendingUrlSync.current = true;
    replaceQuery((p) => p.set("chatId", activeConversationId));
  }, [activeConversationId, chatIdFromUrl]);

  useEffect(() => {
    if (!chatIdFromUrl || pendingUrlSync.current || !conversationsLoaded) return;
    if (chatIdFromUrl === activeConversationId) return;
    if (conversations.some((c) => c.id === chatIdFromUrl)) {
      loadConversation(chatIdFromUrl);
      return;
    }
    // unknown id: fall back to the latest chat, but only once there are chats
    if (conversations.length > 0) loadConversation(conversations[0].id);
  }, [chatIdFromUrl, conversations, conversationsLoaded, activeConversationId, loadConversation]);

  useEffect(() => {
    if (!pendingUrlSync.current) return;
    if (activeConversationId ? chatIdFromUrl === activeConversationId : !chatIdFromUrl) {
      pendingUrlSync.current = false;
    }
  }, [chatIdFromUrl, activeConversationId]);

  return (
    <div className="legacy">
      <QueryTimeoutModal
        isOpen={showQueryTimeoutModal || (didRelaysTimeout && !isWalletLoading)}
        onClose={() => {
          setShowQueryTimeoutModal(false);
          setDidRelaysTimeout(false);
        }}
      />
    </div>
  );
}

function Content() {
  const { ready: authChecked } = useSession();
  // the boot mark stays over the app as it mounts, then becomes its logo
  const [booted, setBooted] = useState(false);
  return (
    <>
      {authChecked && (
        <UiProvider>
          <Shell />
          <Behaviour />
        </UiProvider>
      )}
      {!booted && <Boot ready={authChecked} onDone={() => setBooted(true)} />}
    </>
  );
}

export default function App() {
  return (
    <RoomProvider>
      <AuthProvider>
        <ChatProvider>
          <KeepAliveProvider>
            <Content />
          </KeepAliveProvider>
        </ChatProvider>
      </AuthProvider>
    </RoomProvider>
  );
}
