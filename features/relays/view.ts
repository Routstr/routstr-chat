import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { RelayStatus } from "./ports";
import type { Relays } from "./service";

export type { RelayStatus } from "./ports";

/** The tab's relay layer. Filled by the composition root. */
export const RelaysContext = createContext<Relays | null>(null);

/** This device's relay list (Settings), and a change made from the list as it is then. */
export function useDeviceRelays(): [
  string[],
  (update: (urls: string[]) => string[]) => void,
] {
  const relays = useContext(RelaysContext);
  if (!relays) throw new Error("useDeviceRelays needs the relay layer");
  const list = useSyncExternalStore(
    relays.subscribe,
    relays.device,
    relays.device
  );
  return [list, (update) => relays.setDevice(update(relays.device()))];
}

/** Each relay's connection, looked at again every few seconds: relays report
 *  their own state, and looking never opens one. */
export function useRelayStatus(): (url: string) => RelayStatus {
  const relays = useContext(RelaysContext);
  if (!relays) throw new Error("useRelayStatus needs the relay layer");
  const [, look] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => look((n) => n + 1), 3000);
    return () => window.clearInterval(id);
  }, []);
  return (url) => relays.port.status(url);
}
