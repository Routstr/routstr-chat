import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { LogOut, XCircle, Copy } from "lucide-react";
import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { nip19 } from "nostr-tools";
import NostrRelayManager from "./NostrRelayManager"; // Import the new component
import NWCWalletManager from "./NWCWalletManager"; // Import the NWC wallet manager
import AutoRefillSettings from "./AutoRefillSettings"; // Import auto-refill settings
import ThemeSettings from "./ThemeSettings"; // Import theme settings
import { useChatSync } from "@/hooks/useChatSync";
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
import {
  loadAutoDeleteConversations,
  saveAutoDeleteConversations,
  loadKeepAliveEnabled,
  saveKeepAliveEnabled,
} from "@/utils/storageUtils";

interface GeneralTabProps {
  logout?: () => void;
  router?: AppRouterInstance;
  onClose: () => void;
  // Model configuration moved to Models tab
}

const GeneralTab: React.FC<GeneralTabProps> = ({
  logout,
  router,
  onClose,
  // Model configuration moved to Models tab
}) => {
  // Model configuration moved to Models tab
  const [showNsecWarning, setShowNsecWarning] = useState<boolean>(false);
  const [newNsec, setNewNsec] = useState<string>("");

  const toast = (message: string) => {
    alert(message); // Placeholder for a proper toast notification
  };

  const { manager } = useAccountManager();
  const applesauceAccounts = useObservableState(manager.accounts$) || [];
  const activeApplesauceAccount = useObservableState(manager.active$);
  const { chatSyncEnabled, setChatSyncEnabled } = useChatSync();
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState<boolean>(false);
  const [keepAliveEnabled, setKeepAliveEnabled] = useState<boolean>(false);

  useEffect(() => {
    setAutoDeleteEnabled(loadAutoDeleteConversations());
    setKeepAliveEnabled(loadKeepAliveEnabled());
  }, []);

  useEffect(() => {
    if (localStorage.getItem("nsec_storing_skipped") === "true") {
      setShowNsecWarning(true);
    }
  }, []);

  const handleCloseNsecWarning = () => {
    if (
      window.confirm(
        "Are you sure you want to dismiss this warning? You will not be reminded again unless you clear your browser local storage."
      )
    ) {
      localStorage.setItem("nsec_storing_skipped", "false");
      setShowNsecWarning(false);
    }
  };

  const isValidRelay = (url: string) => {
    try {
      const u = new URL(url.trim());
      return u.protocol === "wss:";
    } catch {
      return false;
    }
  };

  // Model configuration moved to Models tab

  return (
    <>
      {showNsecWarning && (
        <div className="relative bg-red-500/5 border border-red-500/20 text-red-400 px-4 py-3 rounded-md mb-6">
          <p className="text-sm pr-12">
            <span className="font-bold">Warning:</span> Your nsec is currently
            stored only in your browser's local storage. It will be lost if you
            clear your browser data. Please consider exporting and securely
            storing your nsec.
          </p>
          <button
            onClick={handleCloseNsecWarning}
            className="absolute top-3 right-4 p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
            type="button"
            title="Dismiss warning"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Theme Settings */}
      <ThemeSettings />

      {/* Background Keep-Alive Settings */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-foreground/80 mb-2">
          Background Mode
        </h3>
        <div className="bg-muted/50 border border-border rounded-md p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-foreground/70">Keep App Active</div>
              <div className="text-xs text-muted-foreground mt-1">
                Prevents app from sleeping when screen is off (may pause other
                audio)
              </div>
            </div>
            <Switch
              checked={keepAliveEnabled}
              onCheckedChange={(checked) => {
                setKeepAliveEnabled(checked);
                saveKeepAliveEnabled(checked);
                // Reload to apply the change
                window.location.reload();
              }}
            />
          </div>
        </div>
      </div>

      {/* Chat Sync Settings */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-foreground/80 mb-2">
          Chat Sync
        </h3>
        <div className="bg-muted/50 border border-border rounded-md p-3 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-foreground/70">Enable Chat Sync</div>
              <div className="text-xs text-muted-foreground mt-1">
                Sync chat messages with Nostr relays
              </div>
            </div>
            <Switch
              checked={chatSyncEnabled}
              onCheckedChange={setChatSyncEnabled}
            />
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <div className="text-sm text-foreground/70">
                Auto-delete old conversations
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Automatically delete conversations older than 7 days
              </div>
            </div>
            <Switch
              checked={autoDeleteEnabled}
              onCheckedChange={(checked) => {
                setAutoDeleteEnabled(checked);
                saveAutoDeleteConversations(checked);
              }}
            />
          </div>
        </div>
      </div>

      {/* Nostr Relays */}
      <NostrRelayManager />

      {/* NWC Wallet */}
      <NWCWalletManager />

      {/* Auto-Refill Settings */}
      <AutoRefillSettings />

      {/* Model configuration moved to Models tab */}

      {/* Account Section */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-foreground/80 mb-2">Account</h3>
        <div className="mb-3 bg-muted/50 border border-border rounded-md p-3">
          <div className="text-xs text-muted-foreground mb-1">
            Current Account
          </div>
          <div className="font-mono text-xs text-foreground/70 break-all">
            {activeApplesauceAccount?.pubkey || "Not available"}
            {activeApplesauceAccount &&
              " [" + activeApplesauceAccount.type + "]"}
          </div>
        </div>
        {applesauceAccounts.some(
          (acct) => acct.id !== activeApplesauceAccount?.id
        ) && (
          <div className="mb-3 bg-muted/50 border border-border rounded-md p-3">
            <div className="text-xs text-muted-foreground mb-2">
              Switch Account
            </div>
            <div className="flex flex-col gap-2">
              {applesauceAccounts
                .filter((acct) => acct.id !== activeApplesauceAccount?.id)
                .map((acct) => (
                  <div key={acct.id} className="flex items-center gap-2">
                    <div className="flex-1 font-mono text-xs text-muted-foreground break-all">
                      {acct.pubkey} ({acct.type})
                    </div>
                    <button
                      className="px-2 py-1 rounded-md bg-muted hover:bg-muted/80 border border-border text-foreground text-xs transition-colors cursor-pointer"
                      onClick={() => manager.setActive(acct)}
                      type="button"
                    >
                      Use
                    </button>
                    <button
                      className="px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs transition-colors cursor-pointer"
                      onClick={() => manager.removeAccount(acct.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 mt-2">
          {activeApplesauceAccount &&
            activeApplesauceAccount.type === "nsec" && (
              <button
                className="grow flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer"
                onClick={() => {
                  try {
                    const keyData = activeApplesauceAccount.signer.key;
                    // Convert Uint8Array to nsec format
                    const nsec =
                      keyData instanceof Uint8Array
                        ? nip19.nsecEncode(keyData)
                        : "";

                    if (nsec) {
                      navigator.clipboard.writeText(nsec);
                      toast("nsec copied to clipboard!");
                    } else {
                      toast("Unable to export nsec");
                    }
                  } catch (error) {
                    console.error("Error converting key to nsec:", error);
                    toast("Unable to export nsec");
                  }
                }}
                type="button"
              >
                <Copy className="h-4 w-4" />
                <span>Copy nsec</span>
              </button>
            )}
          {logout && router && (
            <button
              className="grow flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 border border-border text-foreground px-3 py-2 rounded-md text-sm transition-colors cursor-pointer"
              onClick={() => {
                if (window.confirm("Are you sure you want to sign out?")) {
                  logout();
                  router.push("/");
                  onClose();
                }
              }}
              type="button"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          )}
        </div>
      </div>

      {/* Version Information */}
      <div className="mt-8 pt-4 border-t border-border">
        <div className="text-xs text-muted-foreground text-center">
          Version 0.3.0
        </div>
      </div>
    </>
  );
};

export default GeneralTab;
