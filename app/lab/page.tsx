"use client";

import { Suspense, useEffect, useState } from "react";
import { AuthContext } from "@/context/AuthProvider";
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
export default function Lab() {
  // client only, like the real app (it waits for auth before drawing)
  const [ready, setReady] = useState(false);
  const signedOut = ready && new URLSearchParams(window.location.search).has("signedout");
  useEffect(() => setReady(true), []);
  if (process.env.NODE_ENV !== "development" || !ready) return null;
  return (
    <Suspense>
      <RoomProvider>
        <AuthContext.Provider value={{ isAuthenticated: !signedOut, authChecked: true, logout: async () => {} }}>
          <FakeChatProvider history={labHistory}>
            <UiProvider>
              <Shell />
              <LabBoot />
            </UiProvider>
          </FakeChatProvider>
        </AuthContext.Provider>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return on ? <Boot ready={ready} first={p.has("firstlight")} onDone={() => setOn(false)} /> : null;
}
