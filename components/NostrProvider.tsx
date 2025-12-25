import { NostrEvent, NPool, NRelay1 } from "@nostrify/nostrify";
import { NostrContext } from "@nostrify/react";
import React, { useRef, useEffect } from "react"; // Import useEffect
import { useAppContext } from "@/hooks/useAppContext";

interface NostrProviderProps {
  children: React.ReactNode;
  // relays: string[];
}

/**
 * Custom NPool implementation that tracks timestamps for published events
 */
class TimestampTrackingNPool extends NPool {
  async event(
    event: NostrEvent,
    opts?: { signal?: AbortSignal; relays?: string[] },
  ): Promise<void> {
    // Call the original event method
    await super.event(event, opts);
  }
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;

  const { config } = useAppContext(); // Keep presetRelays even if not used directly here

  // NPool instance created once
  const pool = useRef<NPool | undefined>(undefined);
  // Use ref for relayUrls to ensure the pool always has the latest config
  const currentRelayUrls = useRef<string[]>(config.relayUrls);

  // Update ref when config.relayUrls changes
  useEffect(() => {
    currentRelayUrls.current = config.relayUrls;
  }, [config.relayUrls]);

  if (!pool.current) {
    pool.current = new TimestampTrackingNPool({
      open(url: string) {
        return new NRelay1(url);
      },
      reqRouter(filters) {
        // Use the ref's current value
        return new Map(currentRelayUrls.current.map((url) => [url, filters]));
      },
      eventRouter(_event: NostrEvent) {
        // Use the ref's current value
        return currentRelayUrls.current;
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;
