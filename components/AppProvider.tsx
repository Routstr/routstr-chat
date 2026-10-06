import { ReactNode } from "react";
import { AppContext, type AppContextType } from "@/context/AppContext";
import { useDeviceRelays } from "@/features/relays/view";

interface AppProviderProps {
  children: ReactNode;
  /** Optional list of preset relays to display in the RelaySelector */
  presetRelays?: { name: string; url: string }[];
}

/** The old screens' view of the relay list: the relay layer owns it. */
export function AppProvider({ children, presetRelays }: AppProviderProps) {
  const [relayUrls, updateRelays] = useDeviceRelays();
  const appContextValue: AppContextType = {
    config: { relayUrls },
    updateConfig: (updater) =>
      updateRelays((urls) => updater({ relayUrls: urls }).relayUrls),
    presetRelays,
  };

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}
