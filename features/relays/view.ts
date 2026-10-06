import { createContext, useContext, useSyncExternalStore } from "react";
import type { Relays } from "./service";

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
