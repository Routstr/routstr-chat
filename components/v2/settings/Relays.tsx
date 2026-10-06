"use client";

import React, { useState } from "react";
import { useDeviceRelays, useRelayStatus } from "@/features/relays/view";
import { Icon } from "../icons";
import { Btn, GoneRow, Grp, Ib, at, hostOf, plural, useGone } from "./parts";

export default function Relays() {
  const [relays, updateRelays] = useDeviceRelays();
  const [relayIn, setRelayIn] = useState("");
  const [relayErr, setRelayErr] = useState("");
  // one nothing has opened (signed out, nothing syncs) is idle
  const stateOf = useRelayStatus();
  const ok = relays.filter((u) => stateOf(u) === "ok").length;
  const idle = relays.every((u) => stateOf(u) === "idle");
  const addRelay = () => {
    const v = relayIn.trim();
    if (!/^wss?:\/\/[^\s]+\.[^\s]+/i.test(v))
      return setRelayErr("Relay addresses look like wss://relay.example.com");
    if (relays.includes(v))
      return setRelayErr("That relay is already in your list.");
    updateRelays((urls) => [...urls, v]);
    setRelayIn("");
    setRelayErr("");
  };
  const goneRelays = useGone();
  const removeRelay = (u: string) => {
    const i = relays.indexOf(u);
    updateRelays((urls) => urls.filter((x) => x !== u));
    goneRelays.drop(u, hostOf(u), i, () => updateRelays((urls) => at(urls, u, i)));
  };
  return (
    <Grp
      id="g-relays"
      k="Relays"
      kv={
        !relays.length
          ? "None"
          : idle
            ? plural(relays.length, "relay")
            : ok === relays.length
            ? `${relays.length} connected`
            : `${ok} of ${relays.length} connected`
      }
    >
      <div className="st-items st-relays">
        {goneRelays
          .merge(relays, (u) => u)
          .map(({ item: u, gone, key }) => {
            if (gone)
              return (
                <GoneRow
                  key={key}
                  label={gone.label}
                  onUndo={() => goneRelays.restore(key)}
                />
              );
            const s = stateOf(u);
            return (
              <div className="st-it st-rel" key={u}>
                <span className="st-dot" data-s={s} aria-hidden="true" />
                <span className="st-it-t">{hostOf(u)}</span>
                <span className="st-it-r st-swap">
                  <span
                    className="st-rs"
                    data-tone={s === "bad" ? "warn" : undefined}
                  >
                    {s === "bad" ? (
                      "Not reachable"
                    ) : s === "wait" ? (
                      "Connecting"
                    ) : s === "idle" ? null : (
                      <span className="sr">Connected</span>
                    )}
                  </span>
                  <Ib
                    icon="close"
                    label={`Remove ${hostOf(u)}`}
                    hov
                    onClick={() => removeRelay(u)}
                  />
                </span>
              </div>
            );
          })}
      </div>
      {!relays.length && (
        <div className="st-emptyrow">
          <span className="st-it-ic">
            <Icon name="sync" />
          </span>
          <p className="st-rn">No relays. Chats stay on this device only.</p>
        </div>
      )}
      <div className="st-add st-stackm">
        <input
          className="st-in mono"
          placeholder="wss://relay.example.com"
          aria-label="Add a relay"
          aria-invalid={relayErr ? true : undefined}
          enterKeyHint="done"
          autoCapitalize="off"
          spellCheck={false}
          value={relayIn}
          onChange={(e) => {
            setRelayIn(e.target.value);
            setRelayErr("");
          }}
          onKeyDown={(e) => e.key === "Enter" && addRelay()}
        />
        <Btn icon="plus" onClick={addRelay}>
          Add relay
        </Btn>
        <p className="st-err" role="alert">
          {relayErr}
        </p>
      </div>
    </Grp>
  );
}
