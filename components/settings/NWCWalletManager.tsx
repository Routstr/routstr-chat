import React, { useState } from "react";
import { Link2, Wifi, WifiOff, Loader, AlertCircle } from "lucide-react";
import { useBitcoinConnectStatus } from "@/hooks/useBitcoinConnect";

const NWCWalletManager: React.FC = () => {
  const {
    status: nwcStatus,
    balance: nwcBalance,
    providerName: walletProvider,
    connect,
    disconnect,
    reset,
  } = useBitcoinConnectStatus();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnect();
      reset();
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
      await connect();
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
                            {nwcBalance.toLocaleString()} sats
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
