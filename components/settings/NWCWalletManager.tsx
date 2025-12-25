import React, { useState, useEffect } from "react";
import { Zap, Link2, Wifi, WifiOff, Loader, AlertCircle } from "lucide-react";
import { useAppContext } from "@/hooks/useAppContext";
import { formatSats } from "@/features/wallet";

const NWCWalletManager: React.FC = () => {
  const { config } = useAppContext();
  const unit = config.unit || "₿";
  const [nwcStatus, setNwcStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [nwcBalance, setNwcBalance] = useState<number | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false);
  const [walletProvider, setWalletProvider] = useState<string | null>(null);

  useEffect(() => {
    let unsubConnect: undefined | (() => void);
    let unsubDisconnect: undefined | (() => void);
    let unsubConnecting: undefined | (() => void);

    (async () => {
      try {
        const mod = await import("@getalby/bitcoin-connect-react");

        const fetchBalance = async (provider: any): Promise<number | null> => {
          try {
            if (provider && typeof provider.getBalance === "function") {
              const res = await provider.getBalance();
              if (typeof res === "number") return res;
              if (res && typeof res === "object") {
                if (
                  "balance" in res &&
                  typeof (res as any).balance === "number"
                ) {
                  const unit = ((res as any).unit || "")
                    .toString()
                    .toLowerCase();
                  const n = (res as any).balance as number;
                  return unit.includes("msat") ? Math.floor(n / 1000) : n;
                }
                if (
                  "balanceMsats" in res &&
                  typeof (res as any).balanceMsats === "number"
                ) {
                  return Math.floor((res as any).balanceMsats / 1000);
                }
              }
            }
          } catch {}
          return null;
        };

        unsubConnecting = mod.onConnecting?.(() => setNwcStatus("connecting"));
        unsubConnect = mod.onConnected?.(async (provider: any) => {
          setNwcStatus("connected");
          const sats = await fetchBalance(provider);
          if (sats !== null) setNwcBalance(sats);

          // Extract wallet provider name
          try {
            const cfg = mod.getConnectorConfig?.();
            if (cfg && typeof cfg === "object" && "name" in cfg) {
              setWalletProvider((cfg as any).name || null);
            }
          } catch {}
        });
        unsubDisconnect = mod.onDisconnected?.(() => {
          setNwcStatus("disconnected");
          setNwcBalance(null);
          setWalletProvider(null);
        });

        // Check if already connected
        try {
          const cfg = mod.getConnectorConfig?.();
          if (cfg) {
            setNwcStatus("connected");
            // Extract wallet provider name if available
            if (cfg && typeof cfg === "object" && "name" in cfg) {
              setWalletProvider((cfg as any).name || null);
            }
            try {
              const provider = await mod.requestProvider();
              const sats = await fetchBalance(provider);
              if (sats !== null) setNwcBalance(sats);
            } catch {}
          }
        } catch {}
      } catch {}
    })();

    return () => {
      try {
        unsubConnect && unsubConnect();
      } catch {}
      try {
        unsubDisconnect && unsubDisconnect();
      } catch {}
      try {
        unsubConnecting && unsubConnecting();
      } catch {}
    };
  }, []);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const mod = await import("@getalby/bitcoin-connect-react");
      await mod.disconnect();
      setNwcStatus("disconnected");
      setNwcBalance(null);
      setWalletProvider(null);
    } catch (error) {
      console.error("Error disconnecting NWC wallet:", error);
    } finally {
      setIsDisconnecting(false);
      setShowConfirmDisconnect(false);
    }
  };

  const confirmDisconnect = () => {
    setShowConfirmDisconnect(true);
  };

  const cancelDisconnect = () => {
    setShowConfirmDisconnect(false);
  };

  const handleConnect = async () => {
    try {
      const mod = await import("@getalby/bitcoin-connect-react");
      await mod.launchModal();
    } catch (error) {
      console.error("Error launching NWC modal:", error);
    }
  };

  const getStatusIcon = () => {
    switch (nwcStatus) {
      case "connected":
        return <Wifi className="h-4 w-4 text-green-400" />;
      case "connecting":
        return <Loader className="h-4 w-4 text-yellow-400 animate-spin" />;
      case "disconnected":
        return <WifiOff className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = () => {
    switch (nwcStatus) {
      case "connected":
        return "text-green-400";
      case "connecting":
        return "text-yellow-400";
      case "disconnected":
        return "text-muted-foreground";
    }
  };

  const getStatusText = () => {
    switch (nwcStatus) {
      case "connected":
        return "CONNECTED";
      case "connecting":
        return "CONNECTING";
      case "disconnected":
        return "NOT CONNECTED";
    }
  };

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-foreground/80 mb-2">
        Lightning Wallet (NWC)
      </h3>
      <div className="bg-muted/50 border border-border rounded-md p-4">
        <p className="text-sm text-foreground mb-3">
          Connect a Lightning wallet to pay invoices instantly
        </p>

        {nwcStatus === "disconnected" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No wallet connected</p>
            <button
              onClick={handleConnect}
              className="bg-muted hover:bg-muted/80 text-foreground px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-1 cursor-pointer"
              type="button"
            >
              <Link2 className="h-4 w-4" /> Connect Wallet
            </button>
          </div>
        ) : (
          <div>
            {!showConfirmDisconnect ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-muted/50 rounded-md p-2">
                  <div className="flex items-center gap-2 grow min-w-0">
                    {getStatusIcon()}
                    <div className="flex flex-col min-w-0 grow">
                      <span className="text-sm text-foreground truncate">
                        {walletProvider || "Lightning Wallet"}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${getStatusColor()}`}>
                          {getStatusText()}
                        </span>
                        {nwcBalance !== null && nwcStatus === "connected" && (
                          <span className="text-xs text-muted-foreground">
                            {formatSats(nwcBalance, unit)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={confirmDisconnect}
                    disabled={isDisconnecting}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors ml-2 shrink-0 disabled:opacity-50 cursor-pointer"
                    type="button"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-red-500/5 border border-red-500/20 rounded-md p-3">
                <div className="flex items-start gap-2 mb-3">
                  <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-red-400 mb-1">
                      Disconnect Wallet?
                    </h4>
                    <p className="text-xs text-red-300/80">
                      You won't be able to pay Lightning invoices until you
                      reconnect
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={cancelDisconnect}
                    disabled={isDisconnecting}
                    className="flex-1 px-3 py-2 rounded-md bg-muted hover:bg-muted/80 border border-border text-foreground text-sm transition-colors cursor-pointer disabled:opacity-50"
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={isDisconnecting}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 hover:text-red-300 text-sm font-medium transition-all cursor-pointer disabled:opacity-50"
                    type="button"
                  >
                    {isDisconnecting ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      "Yes, Disconnect"
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NWCWalletManager;
