"use client";

import React, { useEffect, useState } from "react";
import { normalizeURL } from "applesauce-core/helpers/url";
import { useAppContext } from "@/hooks/useAppContext";
import { relayPool } from "@/lib/applesauce-core";
import { Icon } from "../icons";
import { Btn, GoneRow, Grp, Ib, at, hostOf, useGone } from "./parts";

export default function Relays() {
  const { config, updateConfig } = useAppContext();
  const [relayIn, setRelayIn] = useState("");
  const [relayErr, setRelayErr] = useState("");
  const [, tick] = useState(0);
  useEffect(() => {
    // relays report their own state; look again every few seconds
    const id = window.setInterval(() => tick((n) => n + 1), 3000);
    return () => window.clearInterval(id);
  }, []);
  const relays = config.relayUrls;
  // read without opening one (relay() would create it, and a fresh relay is not yet connected): a
  // relay is 'bad' only after it has tried and failed, until then it is connecting
  const stateOf = (u: string): "ok" | "bad" | "wait" => {
    const r = relayPool.relays.get(normalizeURL(u));
    return !r ? "wait" : r.connected ? "ok" : r.error$.value || r.attempts$.value > 0 ? "bad" : "wait";
  };
  const ok = relays.filter((u) => stateOf(u) === "ok").length;
  const addRelay = () => {
    const v = relayIn.trim();
    if (!/^wss?:\/\/[^\s]+\.[^\s]+/i.test(v))
      return setRelayErr("Relay addresses look like wss://relay.example.com");
    if (relays.includes(v))
      return setRelayErr("That relay is already in your list.");
    updateConfig((c) => ({ ...c, relayUrls: [...c.relayUrls, v] }));
    setRelayIn("");
    setRelayErr("");
  };
  const goneRelays = useGone();
  const removeRelay = (u: string) => {
    const i = config.relayUrls.indexOf(u);
    updateConfig((c) => ({
      ...c,
      relayUrls: c.relayUrls.filter((x) => x !== u),
    }));
    goneRelays.drop(u, hostOf(u), i, () =>
      updateConfig((c) => ({ ...c, relayUrls: at(c.relayUrls, u, i) }))
    );
  };
  return (
    <Grp
      id="g-relays"
      k="Relays"
      kv={
        !relays.length
          ? "None"
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
                    ) : (
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
