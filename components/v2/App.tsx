"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/features/session/view";
import { useAccountChat, useAnswering } from "@/features/chat/view";
import { KeepAliveProvider, useKeepAliveContext } from "@/components/pwa/KeepAliveProvider";
import { QueryTimeoutModal } from "@/components/QueryTimeoutModal";
import { useCashuWallet } from "@/features/wallet";
import { peek, usePurse } from "@/features/wallet/view";
import { useAutoRefill } from "@/hooks/useAutoRefill";
import { RoomProvider } from "./room/RoomProvider";
import { UiProvider, useUi } from "./ui";
import { showQuery } from "./address";
import { OpenChatProvider, useOpenChat } from "./openChat";
import { MoneyProvider, useMoney } from "./useMoney";
import { useEnsureAccount } from "./useEnsureAccount";
import Shell from "./Shell";
import Boot from "./Boot";
import "./styles/index.css";

/* Everything the app does that is not drawing: keep-alive while answering,
   auto-refill, the relay timeout notice, a ?cashu= link, and the chat in
   the address bar. The drawing is Shell. */
function Behaviour() {
  const searchParams = useSearchParams();
  const { pubkey, ready: authChecked } = useSession();
  const isAuthenticated = pubkey !== null;
  const { id: openId } = useOpenChat();
  const isStreaming = useAnswering() !== null;
  const accountChat = useAccountChat();
  const ui = useUi();
  const { startKeepAlive, stopKeepAlive, isEnabled: keepAliveEnabled } = useKeepAliveContext();
  const {
    showQueryTimeoutModal,
    setShowQueryTimeoutModal,
    didRelaysTimeout,
    setDidRelaysTimeout,
  } = useCashuWallet();
  const money = useMoney();
  const isWalletLoading = money.loading;
  const purse = usePurse();
  const ensureAccount = useEnsureAccount();

  // keep the tab alive while an answer streams, if the person asked for it
  useEffect(() => {
    if (!keepAliveEnabled) return;
    if (isStreaming) startKeepAlive();
    else stopKeepAlive();
  }, [isStreaming, keepAliveEnabled, startKeepAlive, stopKeepAlive]);

  // only once the wallet has loaded, so a zero on boot is not mistaken for empty
  useAutoRefill({ balance: money.wallet, isWalletLoaded: !isWalletLoading });

  // leaving a chat hands back what providers still hold for this account
  useEffect(() => accountChat?.viewing(openId), [accountChat, openId]);

  const qs = searchParams.toString();
  const replaceQuery = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(qs);
    mutate(p);
    showQuery(p.toString());
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
        peek(token);
        ensureAccount();
        const into = purse();
        if (!into) throw new Error("There is no account to receive into.");
        // what the mint gave back, after any fee; a mint that does not answer
        // keeps them waiting in the wallet until it does
        const { sats, pending } = await into.take(token);
        if (pending) toast.info(`${sats.toLocaleString()} sats are waiting for their mint. They come in once it answers.`);
        else toast.success(`${sats.toLocaleString()} sats received`);
        replaceQuery((p) => p.delete("cashu"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "That token could not be received");
      }
    })();
  }, [authChecked, cashuParam, isAuthenticated, isWalletLoading]);

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
          <OpenChatProvider>
            <MoneyProvider>
              <Shell />
              <Behaviour />
            </MoneyProvider>
          </OpenChatProvider>
        </UiProvider>
      )}
      {!booted && <Boot ready={authChecked} onDone={() => setBooted(true)} />}
    </>
  );
}

export default function App() {
  return (
    <RoomProvider>
      <KeepAliveProvider>
        <Content />
      </KeepAliveProvider>
    </RoomProvider>
  );
}
