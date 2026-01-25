"use client";

import React from "react";
import NostrRelayManager from "./settings/NostrRelayManager";
import { ModalShell } from "@/components/ui/ModalShell";

interface QueryTimeoutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QueryTimeoutModal: React.FC<QueryTimeoutModalProps> = ({
  isOpen,
  onClose,
}) => {
  const handleRefresh = () => {
    try {
      localStorage.setItem("cashu_relays_timeout", "false");
    } catch {}
    window.location.reload();
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem("cashu_relays_timeout", "false");
    } catch {}
    onClose();
  };

  return (
    <ModalShell
      open={isOpen}
      overlayClassName="bg-background/80 z-50 p-4"
      contentClassName="bg-card border border-border rounded-xl max-w-sm w-full p-5 relative"
    >
      <h2 className="text-xl font-semibold text-center text-foreground mb-4">
        Connection Timeout
      </h2>
      <p className="text-sm text-muted-foreground mb-4 text-center">
        It looks like there was a problem connecting to the relays. Please
        add/remove relays and refresh the page to try again.
      </p>
      <NostrRelayManager />
      <div className="flex gap-3 justify-center">
        <button
          onClick={handleDismiss}
          className="flex-1 py-2 bg-muted hover:bg-muted/80 border border-border text-foreground rounded-lg text-sm font-medium transition-all cursor-pointer"
          type="button"
        >
          Dismiss
        </button>
        <button
          onClick={handleRefresh}
          className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
          type="button"
        >
          Refresh Page
        </button>
      </div>
    </ModalShell>
  );
};
