"use client";

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AccountContext, useAccountManager } from "@/features/session/view";
import type { SessionService } from "@/features/session/service";
import { RoomProvider } from "@/components/v2/room/RoomProvider";
import { UiProvider } from "@/components/v2/ui";
import { FakeChatProvider } from "@/components/v2/lab/FakeChat";
import { labHistory } from "./labHistory";
import Shell from "@/components/v2/Shell";
import Boot from "@/components/v2/Boot";
import "@/components/v2/styles/index.css";

/* Development only: the real v2 surfaces driven by a simulated chat, so every
   state can be seen without spending sats. ?fresh=1 ?chat=c2 ?balance=0
   ?fail=1 ?nothink=1 ?still=1 ?signedout=1 ?loading=1, and ?boot=<ms> (the boot
   mark, then first light after that long; add ?firstlight=1 for the first visit). Renders nothing in a production build. */
// a made-up key, so the lab draws signed-in views without touching this device's accounts
const LAB_PUBKEY = "1ab".padEnd(64, "0");

export default function Lab() {
  // client only, like the real app (it waits for auth before drawing)
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const signedOut = ready && new URLSearchParams(window.location.search).has("signedout");
  const { manager, session: real } = useAccountManager();
  // who is signed in is made up; everything else (a key made on first money) is the real session
  const account = useMemo(() => {
    const now = { accountId: signedOut ? null : "lab", pubkey: signedOut ? null : LAB_PUBKEY, generation: 1 };
    const session = new Proxy(real, {
      get(target, key) {
        if (key === "getSnapshot") return () => now;
        if (key === "subscribe") return () => () => {};
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { manager, session: session as SessionService };
  }, [manager, real, signedOut]);
  if (process.env.NODE_ENV !== "development" || !ready) return null;
  return (
    <Suspense>
      <RoomProvider>
        <AccountContext.Provider value={account}>
          <FakeChatProvider history={labHistory}>
            <UiProvider>
              <Shell />
              <LabBoot />
            </UiProvider>
          </FakeChatProvider>
        </AccountContext.Provider>
      </RoomProvider>
    </Suspense>
  );
}

function LabBoot() {
  const [p] = useState(() => new URLSearchParams(window.location.search));
  const [on, setOn] = useState(() => p.has("boot"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setReady(true), Number(p.get("boot")) || 1400);
    return () => window.clearTimeout(t);
  }, []);
  return on ? <Boot ready={ready} first={p.has("firstlight")} onDone={() => setOn(false)} /> : null;
}
