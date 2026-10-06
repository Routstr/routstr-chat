"use client";

import React, { useState } from "react";
import type { RemoteNode } from "@/features/node/view";
import { Icon } from "../icons";
import { Btn, Fold, Grp, Row, Say, Sw, hostOf } from "./parts";

export default function NodeConnected({
  node,
  mismatch,
  pays,
  busy,
  connect,
  persist,
}: {
  node: RemoteNode;
  mismatch: boolean;
  pays: boolean;
  busy: boolean;
  connect: () => Promise<void>;
  persist: (n: RemoteNode | null) => void;
}) {
  const [off, setOff] = useState(false);
  return (
    <>
      <Grp
        id="g-node"
        k="Node"
        // the same word the index shows for it
        kv={mismatch ? "Other key" : pays ? "Paying" : "Paused"}
        tone={mismatch ? "warn" : pays ? "ok" : undefined}
      >
        <div className="st-items">
          <div className={`st-it${mismatch ? " st-it-two" : ""}`}>
            <span className={`st-it-ic${mismatch ? "" : " lit"}`}>
              <Icon name="servers" />
            </span>
            <div className="st-it-m">
              <span className="st-it-t">{hostOf(node.url)}</span>
              <span
                className="st-it-s"
                data-tone={mismatch ? "warn" : undefined}
              >
                {mismatch
                  ? "Connected with another key"
                  : "Connected with your key"}
              </span>
            </div>
            <div className="st-it-r">
              <Btn
                kind="bare"
                controls="f-nodeoff"
                open={off}
                onClick={() => setOff((o) => !o)}
              >
                Disconnect
              </Btn>
              {mismatch && (
                <Btn
                  kind="prime"
                  busy={busy && "Connecting"}
                  onClick={() => void connect()}
                >
                  Reconnect
                </Btn>
              )}
            </div>
          </div>
        </div>
        {mismatch && (
          <p className="st-rn st-warnline">
            This connection was made while you used a different key. Reconnect
            to use the node with this one.
          </p>
        )}
        <Fold id="f-nodeoff" open={off}>
          <Say
            inset="r"
            acts={
              <>
                <Btn onClick={() => setOff(false)}>Cancel</Btn>
                <Btn
                  onClick={() => {
                    persist(null);
                    setOff(false);
                  }}
                >
                  Disconnect
                </Btn>
              </>
            }
          >
            <p>
              Disconnect from <b>{hostOf(node.url)}</b>? Chats go back to
              being paid from your wallet.
            </p>
          </Say>
        </Fold>
      </Grp>
      {!mismatch && (
        <Grp id="g-nodepay" k="Paying">
          <Row
            title="Let the node pay"
            note="While it pays, chats never fall back to your wallet. If the node cannot be reached, the message fails instead."
          >
            <Sw
              on={node.enabled}
              label="Let the node pay"
              onChange={(v) => persist({ ...node, enabled: v })}
            />
          </Row>
        </Grp>
      )}
    </>
  );
}
