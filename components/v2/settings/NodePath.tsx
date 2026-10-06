"use client";

import React from "react";
import type { RemoteNode } from "@/features/node/view";
import { hostOf } from "./parts";

export default function NodePath({ node, on, mismatch, pays }: { node: RemoteNode | null; on: boolean; mismatch: boolean; pays: boolean }) {
  return (
  <>
    <div
      className="st-path"
      // lit only while messages really go through it: a node that does not pay is not used
      data-on={pays ? "" : undefined}
      aria-hidden="true"
      data-anchor=""
      data-anchor-box=""
    >
      <span className="st-path-n">You</span>
      <i className="st-path-l" />
      <span className="st-path-n st-path-node">
        {on && !mismatch ? hostOf(node!.url) : "Your node"}
      </span>
      <i className="st-path-l" />
      <span className="st-path-n">Providers</span>
    </div>
    <p className="st-foot st-path-cap" aria-live="polite">
      {pays
        ? "Your node pays for every reply. Your balance here stays as it is."
        : on && !mismatch
          ? "Switched off, so messages go straight to providers and your wallet pays. The node is kept for when you turn it back on."
          : "Messages go to your node instead of straight to a provider. The node pays with its own wallet, so your balance here stays as it is."}
    </p>
  </>
  );
}
