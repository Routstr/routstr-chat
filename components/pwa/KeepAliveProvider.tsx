"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { useKeepAlive } from "@/hooks/useKeepAlive";
import { loadKeepAliveEnabled } from "@/utils/storageUtils";

interface KeepAliveContextType {
  /** Whether keep-alive is currently active (audio playing) */
  isActive: boolean;
  /** Start keep-alive (e.g., when inference starts) */
  startKeepAlive: () => void;
  /** Stop keep-alive (e.g., when inference ends) */
  stopKeepAlive: () => void;
  /** Whether the feature is enabled in settings */
  isEnabled: boolean;
}

const KeepAliveContext = createContext<KeepAliveContextType | null>(null);

/**
 * Hook to access keep-alive controls from anywhere in the app.
 * Use this to start/stop keep-alive during inference.
 */
export function useKeepAliveContext() {
  const context = useContext(KeepAliveContext);
  if (!context) {
    throw new Error(
      "useKeepAliveContext must be used within a KeepAliveProvider"
    );
  }
  return context;
}

/**
 * Provider component that enables silent audio keep-alive for the PWA.
 * This prevents mobile browsers from suspending the app when the screen is off.
 *
 * The feature is controlled by a user setting in localStorage and is OFF by default.
 * When enabled, it will only activate during inference (when startKeepAlive is called).
 */
export function KeepAliveProvider({ children }: { children: ReactNode }) {
  // the setting, read once (false where there is no storage, as in the static render)
  const [isEnabled] = useState(loadKeepAliveEnabled);
  const [shouldBeActive, setShouldBeActive] = useState(false);

  // Only pass enabled=true to useKeepAlive when both:
  // 1. Feature is enabled in settings
  // 2. We're currently in inference (shouldBeActive)
  const { isActive, start, stop } = useKeepAlive(isEnabled && shouldBeActive);

  const startKeepAlive = useCallback(() => {
    if (isEnabled) {
      setShouldBeActive(true);
      // The useKeepAlive hook will auto-start on user interaction
      // But we can also try to start directly if there was already interaction
      start();
    }
  }, [isEnabled, start]);

  const stopKeepAlive = useCallback(() => {
    setShouldBeActive(false);
    stop();
  }, [stop]);

  return (
    <KeepAliveContext.Provider
      value={{
        isActive,
        startKeepAlive,
        stopKeepAlive,
        isEnabled,
      }}
    >
      {children}
    </KeepAliveContext.Provider>
  );
}
