"use client";

import React, { useState } from "react";
import { nip19 } from "nostr-tools";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/features/session/view";
import { NodeError, nodeUrl, useNode } from "@/features/node/view";
import { useUi } from "../ui";
import { Btn, Grp, Head, Row } from "./parts";
import NodePath from "./NodePath";
import NodeConnected from "./NodeConnected";
import NodeForm, { type NodeErr } from "./NodeForm";

export default function Node() {
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  const ui = useUi();
  const { node, save: persist, connect: link } = useNode();
  const [url, setUrl] = useState(node?.url ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<NodeErr>(null);
  const npub = active ? nip19.npubEncode(active.pubkey) : "";
  const connect = async () => {
    setErr(null);
    const normalized = nodeUrl(url);
    if (!normalized)
      return setErr({
        text: "Enter the address of a routstrd node, like https://node.example",
      });
    if (!active) return;
    setBusy(true);
    try {
      await link(normalized, active.pubkey, active);
      setUrl(normalized);
    } catch (e) {
      setErr(
        e instanceof NodeError && e.unauthorized
          ? {
              text: "The node answered, but it does not know your key yet.",
              unauth: true,
            }
          : {
              // the node link words its errors for the person
              text: e instanceof NodeError ? e.message : "Could not reach a routstrd node at that address. Check it, and that the node is running.",
            }
      );
    } finally {
      setBusy(false);
    }
  };
  const on = !!node;
  const mismatch = on && !!active && node!.pubkey !== active.pubkey;
  const pays = on && !mismatch && node!.enabled;
  return (
    <>
      <Head
        title="Remote node"
        lede="Chats go through your routstrd node, which pays from its own wallet."
      />
      {!active ? (
        <Grp id="g-node" k="Node" kv="Off">
          <Row
            wrap
            title="Sign in first"
            note="The node knows you by your public key."
          >
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
        </Grp>
      ) : on ? (
        <NodeConnected node={node!} mismatch={mismatch} pays={pays} busy={busy} connect={connect} persist={persist} />
      ) : (
        <NodeForm url={url} setUrl={setUrl} busy={busy} err={err} setErr={setErr} connect={connect} npub={npub} />
      )}
      <Grp id="g-nodewhat" k="How it works">
        <NodePath node={node} on={on} mismatch={mismatch} pays={pays} />
      </Grp>
    </>
  );
}
