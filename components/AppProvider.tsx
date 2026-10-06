import { ReactNode } from "react";
import { AppContext, type AppContextType } from "@/context/AppContext";
import { useDeviceRelays } from "@/features/relays/view";

interface AppProviderProps {
  children: ReactNode;
}

/** The old screens' view of the relay list: the relay layer owns it. */
export function AppProvider({ children }: AppProviderProps) {
  const [relayUrls, updateRelays] = useDeviceRelays();
  const appContextValue: AppContextType = {
    config: { relayUrls },
    updateConfig: (updater) =>
      updateRelays((urls) => updater({ relayUrls: urls }).relayUrls),
  };

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}
