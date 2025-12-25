import React, { useState } from "react";
import {
  Plus,
  XCircle,
  Wifi,
  WifiOff,
  Clock,
  Loader,
  RefreshCw,
} from "lucide-react";
import { useAppContext } from "@/hooks/useAppContext";
import { useNostr } from "@nostrify/react";

const NostrRelayManager: React.FC = () => {
  const { config, updateConfig } = useAppContext();
  const { nostr } = useNostr();
  const [newRelayInput, setNewRelayInput] = useState<string>("");

  const nostrRelays = config.relayUrls;
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get relay connection status using same logic as useCashuWallet
  const getRelayStatus = (relayUrl: string) => {
    if (!nostr.relays) return { status: "unknown", readyStateText: "UNKNOWN" };

    const relay = nostr.relays.get(relayUrl);
    if (!relay)
      return { status: "not_connected", readyStateText: "NOT CONNECTED" };

    const socket = (relay as any).socket;
    const readyState = socket?._underlyingWebsocket?.readyState;
    const closedByUser = socket?._closedByUser;
    const lastConnection = socket?._lastConnection;
    const idleTimer = (relay as any).idleTimer;

    const getReadyStateText = (state: number) => {
      switch (state) {
        case 0:
          return "CONNECTING";
        case 1:
          return "OPEN";
        case 2:
          return "CLOSING";
        case 3:
          return "CLOSED";
        default:
          return "UNKNOWN";
      }
    };

    // Determine actual status based on multiple factors
    let status: string;
    let statusText: string;

    if (readyState === 1) {
      status = "connected";
      statusText = "CONNECTED";
    } else if (readyState === 0) {
      status = "connecting";
      statusText = "CONNECTING";
    } else if (idleTimer !== undefined && idleTimer > 0) {
      // Connection exists but is idle
      status = "idle";
      statusText = `IDLE`;
    } else if (closedByUser) {
      status = "closed_by_user";
      statusText = "CLOSED BY USER";
    } else if (readyState === 3 || readyState === 2) {
      status = "disconnected";
      statusText = getReadyStateText(readyState);
    } else {
      status = "unknown";
      statusText = "UNKNOWN";
    }

    // Add last connection info if available
    let lastConnectionText = "";
    if (lastConnection) {
      const lastConnTime = new Date(lastConnection);
      const now = new Date();
      const diffMinutes = Math.floor(
        (now.getTime() - lastConnTime.getTime()) / (1000 * 60),
      );

      if (diffMinutes < 1) {
        lastConnectionText = "just now";
      } else if (diffMinutes < 60) {
        lastConnectionText = `${diffMinutes}m ago`;
      } else {
        const diffHours = Math.floor(diffMinutes / 60);
        lastConnectionText = `${diffHours}h ago`;
      }
    }

    return {
      status,
      readyState,
      readyStateText: statusText,
      closedByUser,
      idleTimer,
      lastConnection,
      lastConnectionText,
    };
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <Wifi className="h-4 w-4 text-green-400" />;
      case "connecting":
        return <Loader className="h-4 w-4 text-yellow-400 animate-spin" />;
      case "idle":
        return <Clock className="h-4 w-4 text-blue-400" />;
      case "closed_by_user":
        return <XCircle className="h-4 w-4 text-orange-400" />;
      case "disconnected":
        return <WifiOff className="h-4 w-4 text-red-400" />;
      case "not_connected":
        return <Clock className="h-4 w-4 text-gray-400" />;
      default:
        return <WifiOff className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "text-green-400";
      case "connecting":
        return "text-yellow-400";
      case "idle":
        return "text-blue-400";
      case "closed_by_user":
        return "text-orange-400";
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

  const handleRefreshConnections = async () => {
    setIsRefreshing(true);
    try {
      // Use a simple query to test all relay connections
      // This will attempt to connect to all relays and fetch a minimal result
      const testFilter = {
        kinds: [1], // Note events
        limit: 1, // Only need one event to test the connection
        since: Math.floor(Date.now() / 1000) - 3600, // Only check last hour to minimize data
      };

      console.log("Testing relay connections with query...");

      // This will attempt to connect to all configured relays
      const events = nostr.query([testFilter]);

      // Give it a moment to attempt connections
      await new Promise((resolve) => setTimeout(resolve, 2000));

      console.log("Relay connection test completed");
    } catch (error) {
      console.error("Error refreshing relay connections:", error);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 1000);
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground/80">
          Nostr Management
        </h3>
        <button
          onClick={handleRefreshConnections}
          disabled={isRefreshing}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 text-foreground rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
        >
          <RefreshCw
            className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
          />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <div className="bg-muted/50 border border-border rounded-md p-4">
        <p className="text-sm text-foreground mb-3">
          Manage your Nostr relay connections
        </p>
        <div className="max-h-48 overflow-y-auto space-y-2 mb-4">
          {nostrRelays.length > 0 ? (
            nostrRelays.map((relay, index) => {
              const relayStatus = getRelayStatus(relay);
              return (
                <div
                  className="flex items-center justify-between bg-muted/50 rounded-md p-2"
                  key={index}
                >
                  <div className="flex items-center gap-2 flex-grow min-w-0">
                    {getStatusIcon(relayStatus.status)}
                    <div className="flex flex-col min-w-0 flex-grow">
                      <span className="text-sm text-foreground truncate">
                        {relay}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs ${getStatusColor(
                            relayStatus.status,
                          )}`}
                        >
                          {relayStatus.readyStateText}
                        </span>
                        {relayStatus.lastConnectionText &&
                          relayStatus.status !== "connected" && (
                            <span className="text-xs text-muted-foreground">
                              Last: {relayStatus.lastConnectionText}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveRelay(relay)}
                    className="text-red-400 hover:text-red-500 transition-colors ml-2 flex-shrink-0"
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
            className="flex-grow bg-muted/50 border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none"
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
