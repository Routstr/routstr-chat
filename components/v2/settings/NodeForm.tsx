"use client";

import React from "react";
import { Btn, Grp, Ib, Say, useCopied } from "./parts";

export type NodeErr = { text: string; unauth?: boolean } | null;

export default function NodeForm({
  url,
  setUrl,
  busy,
  err,
  setErr,
  connect,
  npub,
}: {
  url: string;
  setUrl: (url: string) => void;
  busy: boolean;
  err: NodeErr;
  setErr: (err: NodeErr) => void;
  connect: () => Promise<void>;
  npub: string;
}) {
  const { done, copy } = useCopied();
  return (
    <Grp
      id="g-node"
      k="Node"
      kv={busy ? "Connecting" : err ? "Not connected" : "Off"}
    >
      <div className="st-block">
        <label className="st-label" htmlFor="node-url">
          Node address
        </label>
        <div className="st-add st-flush st-stackm">
          <input
            className="st-in mono"
            id="node-url"
            type="url"
            placeholder="https://node.example"
            value={url}
            disabled={busy}
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? "e-node" : undefined}
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              setUrl(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void connect()}
          />
          <Btn
            kind={busy ? undefined : "prime"}
            busy={busy && "Connecting"}
            onClick={() => void connect()}
          >
            Connect
          </Btn>
          <p className="st-err" id="e-node" role="alert">
            {err?.text}
          </p>
        </div>
      </div>
      {err?.unauth && (
        <Say acts={null}>
          <p>
            Send your public key to whoever runs the node. Once they add it,
            press Connect again.
          </p>
          <div className="st-keybox">
            <span>{npub}</span>
            <Ib
              icon={done === "npub" ? "check" : "copy"}
              label="Copy public key"
              onClick={() => void copy(npub, "npub")}
            />
          </div>
        </Say>
      )}
    </Grp>
  );
}
