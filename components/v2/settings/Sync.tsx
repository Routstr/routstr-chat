"use client";

import React, { useState } from "react";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/components/ClientProviders";
import { useSyncSetting } from "@/features/history/view";
import {
  loadAutoDeleteConversations,
  loadKeepAliveEnabled,
  saveAutoDeleteConversations,
  saveKeepAliveEnabled,
} from "@/utils/storageUtils";
import { Btn, Fold, Grp, Head, Row, Sw } from "./parts";
import Relays from "./Relays";
import Files from "./Files";

export default function Sync() {
  const [chatSyncEnabled, setChatSyncEnabled] = useSyncSetting();
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  const [forget, setForget] = useState(loadAutoDeleteConversations);
  const [awake, setAwake] = useState(loadKeepAliveEnabled);
  // the reload note shows only while the switch differs from what the app loaded with
  const [awakeLoaded] = useState(loadKeepAliveEnabled);
  return (
    <>
      <Head
        title="Sync and storage"
      />
      <Grp id="g-chats" k="Chats">
        <Row
          id="r-syncchats"
          title="Sync chats"
          note={
            active
              ? "Encrypted to your key and kept on your relays, so your other devices can read them."
              : "Sign in to sync your chats. Until then they stay on this device."
          }
        >
          <Sw
            on={chatSyncEnabled && !!active}
            label="Sync chats"
            disabled={!active}
            onChange={setChatSyncEnabled}
          />
        </Row>
        <Row
          id="r-forget"
          title="Forget chats after 7 days"
          note="Each time the app opens, chats with no new message for 7 days are deleted here and everywhere they are stored."
        >
          <Sw
            on={forget}
            label="Forget chats after 7 days"
            onChange={(v) => {
              setForget(v);
              saveAutoDeleteConversations(v);
            }}
          />
        </Row>
        <Row
          id="r-awake"
          title="Stay awake while answering"
          note="Plays silent audio while a reply streams, so it keeps going with the screen off. Music you are playing may pause."
        >
          <Sw
            on={awake}
            label="Stay awake while answering"
            controls="f-awake"
            onChange={(v) => {
              setAwake(v);
              saveKeepAliveEnabled(v);

            }}
          />
        </Row>
        <Fold id="f-awake" open={awake !== awakeLoaded}>
          <div className="st-note-row st-tintrow">
            <p className="st-rn">
              Takes effect after the app reloads. Your chat and your draft are
              kept.
            </p>
            <Btn icon="retry" onClick={() => window.location.reload()}>
              Reload now
            </Btn>
          </div>
        </Fold>
      </Grp>
      <Relays />
      <Files />
    </>
  );
}
