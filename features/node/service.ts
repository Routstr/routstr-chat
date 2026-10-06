import { NodeError, type NodeLink, type NodeSigner } from "./ports";

/** A routstrd node that pays for replies instead of the wallet. */
export interface RemoteNode {
  /** Always ends in a slash. */
  url: string;
  apiKey: string;
  /** The npub the key was issued to: another account needs its own. */
  pubkey: string;
  enabled: boolean;
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

// main's key, so a node connected in either app is the same node
export const NODE_KEY = "remote_node";

/** The address as typed, made a base URL: https unless given, one trailing slash. */
export function nodeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * The device's one node setting. Routing, payments and the screens all read
 * it here, so a request never routes by one answer and pays by another.
 */
export class NodeSetting {
  private storage: KeyValueStorage | null = null;
  private raw: string | null = null;
  private node: RemoteNode | null = null;
  private listeners = new Set<() => void>();

  constructor(private link: NodeLink) {}

  /** Once, in the browser, before anything reads it. */
  boot(storage: KeyValueStorage): void {
    this.storage = storage;
    this.read();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The same object until the setting changes. */
  get = (): RemoteNode | null => this.node;

  /** The node, when it is on and its key belongs to this npub. */
  paysFor(pubkey: string | null): RemoteNode | null {
    const node = this.node;
    return node?.enabled && node.apiKey && node.pubkey === pubkey ? node : null;
  }

  /** Throws NodeError when this device cannot store it: kept only in
   *  memory, the old engine (reading storage) would pay by another answer. */
  save(node: RemoteNode | null): void {
    try {
      this.storage?.setItem(NODE_KEY, JSON.stringify(node));
    } catch {
      throw new NodeError("This device's storage is full, so the node setting could not be saved.");
    }
    this.reload();
  }

  /** Asks the node for this app's key and turns it on for this npub. */
  async connect(url: string, pubkey: string, signer: NodeSigner): Promise<void> {
    const apiKey = await this.link.connect(url, signer);
    this.save({ url, apiKey, pubkey, enabled: true });
  }

  /** Reads the setting again (another tab may have changed it). */
  reload(): void {
    if (this.read()) this.listeners.forEach((listener) => listener());
  }

  private read(): boolean {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(NODE_KEY) ?? null;
    } catch {
      // storage blocked: no node
    }
    if (raw === this.raw) return false;
    this.raw = raw;
    try {
      this.node = raw ? (JSON.parse(raw) as RemoteNode | null) : null;
    } catch {
      this.node = null;
    }
    return true;
  }
}
