"use client";

import React, { useRef, useState } from "react";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/components/ClientProviders";
import { useBlossomSync } from "@/hooks/useBlossomSync";
import { DEFAULT_BLOSSOM_SERVERS } from "@/lib/blossom";
import { Btn, Fold, GoneRow, Grp, Ib, Row, Say, Sw, at, hostOf, useGone } from "./parts";

export default function Files() {
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  const {
    blossomSyncEnabled,
    setBlossomSyncEnabled,
    blossomServers,
    setBlossomServers,
  } = useBlossomSync();
  const [serverIn, setServerIn] = useState("");
  const [serverErr, setServerErr] = useState("");
  const [reset, setReset] = useState(false);
  const goneServers = useGone();
  const addServer = () => {
    const v = serverIn.trim();
    try {
      const url = new URL(v);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error();
    } catch {
      return setServerErr(
        "Server addresses look like https://blossom.example.com"
      );
    }
    if (blossomServers.includes(v))
      return setServerErr("That server is already in your list.");
    setBlossomServers([...blossomServers, v]);
    setServerIn("");
    setServerErr("");
  };
  // undo reads the list as it is then (a server added meanwhile stays)
  const isDefault = blossomServers.length === DEFAULT_BLOSSOM_SERVERS.length && DEFAULT_BLOSSOM_SERVERS.every((u) => blossomServers.includes(u));
  const serversNow = useRef(blossomServers);
  serversNow.current = blossomServers;
  const removeServer = (u: string) => {
    const i = blossomServers.indexOf(u);
    setBlossomServers(blossomServers.filter((x) => x !== u));
    goneServers.drop(u, hostOf(u), i, () => setBlossomServers(at(serversNow.current, u, i)));
  };
  return (
    <>
      {/* nothing uploads without a key (the upload needs keys made from it), whatever the switch says */}
      <Grp id="g-files" k="Files" kv={blossomSyncEnabled && active ? "" : "Off"}>
        <Row
          title="Keep files on Blossom servers"
          note={
            active
              ? "Files you attach are uploaded here, so your other devices can open them."
              : "Sign in to keep files on Blossom servers. Until then they stay on this device."
          }
        >
          <Sw
            on={blossomSyncEnabled && !!active}
            label="Keep files on Blossom servers"
            controls="filesbody"
            disabled={!active}
            onChange={setBlossomSyncEnabled}
          />
        </Row>
        {/* signed out there is nothing here to use: the group ends on its switch, as Sync chats does */}
        {active && (
        <div
          id="filesbody"
          className="st-dimmable"
          data-dim={blossomSyncEnabled && active ? undefined : ""}
          inert={!blossomSyncEnabled || !active}
        >
          <div className="st-items st-relays">
            {goneServers
              .merge(blossomServers, (u) => u)
              .map(({ item: u, gone, key }) =>
                gone ? (
                  <GoneRow
                    key={key}
                    label={gone.label}
                    onUndo={() => goneServers.restore(key)}
                  />
                ) : (
                  <div className="st-it st-rel" key={u}>
                    <span className="st-sq" aria-hidden="true" />
                    <span className="st-it-t">{hostOf(u)}</span>
                    <span className="st-it-r st-swap">
                      <span className="st-rs" />
                      <Ib
                        icon="close"
                        label={`Remove ${hostOf(u)}`}
                        hov
                        onClick={() => removeServer(u)}
                      />
                    </span>
                  </div>
                )
              )}
          </div>
          <div className="st-add st-stackm">
            <input
              className="st-in mono"
              placeholder="https://blossom.example.com"
              aria-label="Add a Blossom server"
              aria-invalid={serverErr ? true : undefined}
              enterKeyHint="done"
              autoCapitalize="off"
              spellCheck={false}
              value={serverIn}
              onChange={(e) => {
                setServerIn(e.target.value);
                setServerErr("");
              }}
              onKeyDown={(e) => e.key === "Enter" && addServer()}
            />
            <Btn icon="plus" onClick={addServer}>
              Add server
            </Btn>
            <p className="st-err" role="alert">
              {serverErr}
            </p>
          </div>
          <div className="st-more">
            <span className="st-inl">
              {DEFAULT_BLOSSOM_SERVERS.length} public servers by default
            </span>
            {/* already the defaults: nothing to reset */}
            {!isDefault && (
              <Btn kind="bare" controls="f-reset" open={reset} onClick={() => setReset((o) => !o)}>
                Reset to defaults
              </Btn>
            )}
          </div>
          <Fold id="f-reset" open={reset}>
            <Say
              acts={
                <>
                  <Btn onClick={() => setReset(false)}>Cancel</Btn>
                  <Btn
                    onClick={() => {
                      setBlossomServers(DEFAULT_BLOSSOM_SERVERS);
                      setReset(false);
                    }}
                  >
                    Reset
                  </Btn>
                </>
              }
            >
              <p>
                Go back to the {DEFAULT_BLOSSOM_SERVERS.length} default servers?
                Files already uploaded stay where they are.
              </p>
            </Say>
          </Fold>
        </div>
        )}
      </Grp>
    </>
  );
}
