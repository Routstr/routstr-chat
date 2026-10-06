import { createContext } from "react";

export interface AppConfig {
  /** Selected relay URL */
  relayUrls: string[];
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: AppConfig) => AppConfig) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
