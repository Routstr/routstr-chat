import { useSyncExternalStore } from "react";

/* While a gift's sats are on their way into the balance (gift/GiftLight.tsx), the balance's figure
   waits, so it counts up as they land, not while the room is still dimmed. */
let held = false;
const watchers = new Set<() => void>();

export function holdBalance(on: boolean) {
  if (held === on) return;
  held = on;
  watchers.forEach((w) => w());
}

export const useBalanceHeld = () =>
  useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => watchers.delete(w);
    },
    () => held,
    () => false
  );
