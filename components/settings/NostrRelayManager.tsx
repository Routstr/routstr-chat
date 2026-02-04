import React, { useState } from "react";
import { Plus, XCircle, Wifi, WifiOff } from "lucide-react";
import { useAppContext } from "@/hooks/useAppContext";
import { relayPool } from "@/lib/applesauce-core";

const NostrRelayManager: React.FC = () => {
  const { config, updateConfig } = useAppContext();
  const [newRelayInput, setNewRelayInput] = useState<string>("");

  const nostrRelays = config.relayUrls;

  // Get relay connection status using applesauce-core relay pool
  const getRelayStatus = (relayUrl: string) => {
    const relay = relayPool.relay(relayUrl);
    if (!relay) {
      return { status: "not_connected" as const, statusText: "NOT CONNECTED" };
    }

    const isConnected = relay.connected;

    return {
      status: isConnected ? ("connected" as const) : ("disconnected" as const),
      statusText: isConnected ? "CONNECTED" : "DISCONNECTED",
    };
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <Wifi className="h-4 w-4 text-green-400" />;
      case "disconnected":
        return <WifiOff className="h-4 w-4 text-red-400" />;
      case "not_connected":
        return <WifiOff className="h-4 w-4 text-gray-400" />;
      default:
        return <WifiOff className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "text-green-400";
      case "disconnected":
        return "text-red-400";
      case "not_connected":
        return "text-gray-400";
      default:
        return "text-gray-400";
    }
  };

  const handleAddRelay = () => {
    const trimmedRelay = newRelayInput.trim();
    if (trimmedRelay && !nostrRelays.includes(trimmedRelay)) {
      updateConfig((current) => ({
        ...current,
        relayUrls: [...current.relayUrls, trimmedRelay],
      }));
      setNewRelayInput("");
    }
  };

  const handleRemoveRelay = (relayToRemove: string) => {
    updateConfig((current) => ({
      ...current,
      relayUrls: current.relayUrls.filter((relay) => relay !== relayToRemove),
    }));
  };

  return (
    <div className="mb-6">
      <div className="mb-2">
        <h3 className="text-sm font-medium text-foreground/80">
          Nostr Management
        </h3>
      </div>
      <div className="bg-muted/50 border border-border rounded-md p-4">
        <p className="text-sm text-foreground mb-3">
          Manage your Nostr relay connections
        </p>
        <div className="max-h-48 overflow-y-auto space-y-2 mb-4">
          {nostrRelays.length > 0 ? (
            nostrRelays.map((relay) => {
              const relayStatus = getRelayStatus(relay);
              return (
                <div
                  className="flex items-center justify-between bg-muted/50 rounded-md p-2"
                  key={relay}
                >
                  <div className="flex items-center gap-2 grow min-w-0">
                    {getStatusIcon(relayStatus.status)}
                    <div className="flex flex-col min-w-0 grow">
                      <span className="text-sm text-foreground truncate">
                        {relay}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs ${getStatusColor(
                            relayStatus.status
                          )}`}
                        >
                          {relayStatus.statusText}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveRelay(relay)}
                    className="text-red-400 hover:text-red-500 transition-colors ml-2 shrink-0"
                    type="button"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              No relays added yet.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="grow bg-muted/50 border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none"
            placeholder="Add new Nostr relay URL"
            value={newRelayInput}
            onChange={(e) => setNewRelayInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleAddRelay();
              }
            }}
          />
          <button
            onClick={handleAddRelay}
            className="bg-muted hover:bg-muted/80 text-foreground px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-1"
            type="button"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>
    </div>
  );
};

export default NostrRelayManager;
