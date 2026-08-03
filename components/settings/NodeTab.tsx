"use client";

import React, { useState } from "react";
import { useObservableState } from "applesauce-react/hooks";
import { Copy, Loader2, Server } from "lucide-react";
import { toast } from "sonner";
import { useAccountManager } from "@/components/ClientProviders";
import { Switch } from "@/components/ui/switch";
import { connectRemoteNode, RemoteNodeError } from "@/lib/remoteNode";
import { formatPublicKey } from "@/lib/nostr";
import { normalizeProviderUrl } from "@/utils/torUtils";
import {
  loadRemoteNode,
  saveRemoteNode,
  type RemoteNode,
} from "@/utils/storageUtils";

const NodeTab: React.FC = () => {
  const { manager } = useAccountManager();
  const activeAccount = useObservableState(manager.active$);

  const [node, setNode] = useState<RemoteNode | null>(() => loadRemoteNode());
  const [url, setUrl] = useState(node?.url ?? "");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<{
    message: string;
    unauthorized?: boolean;
  } | null>(null);

  // The operator adds users by npub, so when the node rejects this account,
  // put the npub right under the error for copying.
  const unauthorizedNpub =
    error?.unauthorized && activeAccount
      ? formatPublicKey(activeAccount.pubkey)
      : null;

  const persist = (next: RemoteNode | null) => {
    saveRemoteNode(next);
    setNode(next);
  };

  const handleConnect = async () => {
    setError(null);
    const normalized = normalizeProviderUrl(url);
    if (!normalized) {
      setError({ message: "Enter the address of a routstrd instance." });
      return;
    }
    if (!activeAccount) {
      setError({ message: "Sign in first, the node identifies you by your npub." });
      return;
    }

    setIsConnecting(true);
    try {
      const apiKey = await connectRemoteNode(normalized, activeAccount);
      persist({
        url: normalized,
        apiKey,
        pubkey: activeAccount.pubkey,
        enabled: true,
      });
      setUrl(normalized);
    } catch (e) {
      setError(
        e instanceof RemoteNodeError
          ? { message: e.message, unauthorized: e.unauthorized }
          : { message: "Could not connect to that node." }
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-foreground/80 mb-2">
        Remote node
      </h3>
      <div className="bg-muted/50 border border-border rounded-md p-4">
        <p className="text-sm text-foreground mb-3">
          Route chats through a routstrd instance you have access to. It pays
          for requests, so your wallet is not used.
        </p>

        <div className="flex gap-2 mb-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-node.example"
            className="grow bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground"
            disabled={isConnecting}
          />
          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex items-center gap-2 bg-foreground text-background rounded-md px-3 py-2 text-sm cursor-pointer disabled:opacity-50"
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Server className="h-4 w-4" />
            )}
            {node ? "Reconnect" : "Connect"}
          </button>
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error.message}</p>}

        {unauthorizedNpub && (
          <div className="flex items-center gap-2 mb-3 bg-muted/50 rounded-md px-3 py-2">
            <span className="grow truncate font-mono text-xs text-foreground/80">
              {unauthorizedNpub}
            </span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(unauthorizedNpub);
                  toast.success("Copied!");
                } catch {
                  toast.error("Failed to copy!");
                }
              }}
              className="shrink-0 text-foreground/60 hover:text-foreground cursor-pointer"
              aria-label="Copy npub"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        )}

        {node && (
          <div className="bg-muted/50 rounded-md p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-foreground truncate">{node.url}</span>
              <button
                type="button"
                onClick={() => persist(null)}
                className="text-sm text-red-400 shrink-0 cursor-pointer"
              >
                Disconnect
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground">
                Let this node pay, instead of my wallet
              </span>
              <Switch
                checked={node.enabled}
                onCheckedChange={(checked) =>
                  persist({ ...node, enabled: checked })
                }
              />
            </div>
            <p className="text-xs text-foreground/60 mt-2">
              While the node pays, chats will not fall back to your wallet. If
              the node is unreachable the message fails instead.
            </p>
            {node.pubkey !== activeAccount?.pubkey && (
              <p className="text-xs text-yellow-500 mt-2">
                This key belongs to a different account. Reconnect to use the
                node with this one.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NodeTab;
