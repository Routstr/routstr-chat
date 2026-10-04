"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useUi } from "../ui";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/components/ClientProviders";
import { Btn, Grp, Head, Row } from "./parts";

/* API keys. Their create, top up, refund and delete logic lives in the
   existing panel (it moves money), so for now that panel is shown inside the
   new page; its native rows come next. */

// its own loading state, so waiting for the panel never suspends the page (Settings preloads it)
export const loadKeys = () => import("@/components/settings/ApiKeysTab");
const ApiKeysTab = dynamic(loadKeys, {
  loading: () => (
    <div className="st-ghostlist" aria-label="Loading keys">
      <i>
        <b />
        <s />
      </i>
      <i>
        <b />
        <s />
      </i>
    </div>
  ),
});

export default function Keys() {
  const ui = useUi();
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  return (
    <>
      <Head
        title="API keys"
        lede="Keys let other apps spend sats you set aside, each at one provider. They are being replaced by routstrd, a small app that pays from your own wallet. Keys you have keep working."
      />
      <Grp id="g-keys" k="Your keys">
        {/* keys are kept with an account; signed out, the old panel would wait for ever */}
        {!active ? (
          <Row wrap title="Sign in first" note="Keys are kept with your account.">
            <Btn
              kind="prime"
              onClick={() => {
                ui.closeSettings();
                ui.setFace("auth");
              }}
            >
              Sign in
            </Btn>
          </Row>
        ) : (
        <div className="legacy set-legacy">
          <ApiKeysTab
            setActiveTab={(t) => ui.openSettings(t === "wallet" ? "wallet" : t === "history" ? "history" : "keys")}
            isMobile={typeof window !== "undefined" && window.innerWidth <= 760}
          />
        </div>
        )}
      </Grp>
    </>
  );
}
