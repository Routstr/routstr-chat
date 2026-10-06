import type { EventTemplate, NostrEvent } from "nostr-tools";

/** Signs as the person, for the node's NIP-98 check. */
export interface NodeSigner {
  signEvent(template: EventTemplate): Promise<NostrEvent>;
}

/** A routstrd node, reached over HTTP (platform/node.ts). */
export interface NodeLink {
  /** The API key the node issues this app for the signer's npub: the same
   *  key again on a reconnect or another device. Throws NodeError. */
  connect(url: string, signer: NodeSigner): Promise<string>;
}

/** Why a node would not connect, worded for the person. */
export class NodeError extends Error {
  constructor(
    message: string,
    /** The node answered but does not know this npub yet. */
    readonly unauthorized = false
  ) {
    super(message);
  }
}
