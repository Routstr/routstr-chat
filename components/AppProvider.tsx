import { ReactNode, useEffect } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  AppContext,
  type AppConfig,
  type AppContextType,
} from "@/context/AppContext";
import { fetchBtcPrice } from "@/utils/priceUtils";

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
  /** Optional list of preset relays to display in the RelaySelector */
  presetRelays?: { name: string; url: string }[];
}

export function AppProvider(props: AppProviderProps) {
  const { children, storageKey, defaultConfig, presetRelays } = props;

  // App configuration state with localStorage persistence
  const [config, setConfig] = useLocalStorage<AppConfig>(
    storageKey,
    defaultConfig
  );

  // Periodic BTC price fetch
  useEffect(() => {
    const fetchPrice = async () => {
      await fetchBtcPrice();
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 60000); // Fetch every minute
    return () => clearInterval(interval);
  }, []);

  // Generic config updater with callback pattern
  const updateConfig = (updater: (currentConfig: AppConfig) => AppConfig) => {
    setConfig(updater);
  };

  const appContextValue: AppContextType = {
    config,
    updateConfig,
    presetRelays,
  };

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}
