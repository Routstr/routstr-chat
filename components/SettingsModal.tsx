"use client";

import { useEffect, useState } from "react";
import { Model } from "@/types/models";
import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { TransactionHistory } from "@/types/chat";
import GeneralTab from "./settings/GeneralTab";
import ModelsTab from "@/components/settings/ModelsTab";
import HistoryTab from "./settings/HistoryTab";
import ApiKeysTab from "./settings/ApiKeysTab";
import UnifiedWallet from "@/features/wallet/components/UnifiedWallet";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { DEFAULT_MINT_URL } from "@/lib/utils";
import { ModalShell } from "@/components/ui/ModalShell";
import CloseButton from "@/components/ui/CloseButton";

type SettingsTab = "settings" | "wallet" | "history" | "api-keys" | "models";

const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: "settings", label: "General" },
  { key: "models", label: "Models" },
  { key: "wallet", label: "Wallet" },
  { key: "history", label: "History" },
  { key: "api-keys", label: "API Keys" },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialActiveTab?: SettingsTab;
  baseUrl: string;
  models: readonly Model[];
  balance: number;
  setBalance: (balance: number | ((prevBalance: number) => number)) => void;
  clearConversations: () => void;
  logout?: () => void;
  router?: AppRouterInstance;
  transactionHistory: TransactionHistory[];
  setTransactionHistory: (
    transactionHistory:
      | TransactionHistory[]
      | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])
  ) => void;
  configuredModels: string[];
  toggleConfiguredModel: (modelId: string) => void;
  setConfiguredModels?: (models: string[]) => void;
  modelProviderMap?: Record<string, string>;
  setModelProviderFor?: (modelId: string, baseUrl: string) => void;
  fetchModels?: (balance: number) => Promise<void>;
  isMobile?: boolean;
}

const SettingsModal = ({
  isOpen,
  onClose,
  initialActiveTab,
  baseUrl,
  models,
  balance,
  setBalance,
  clearConversations,
  logout,
  router,
  transactionHistory,
  setTransactionHistory,
  configuredModels,
  toggleConfiguredModel,
  setConfiguredModels,
  modelProviderMap,
  setModelProviderFor,
  fetchModels,
  isMobile: propIsMobile,
}: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialActiveTab || "settings"
  );
  const mediaQueryIsMobile = useMediaQuery("(max-width: 640px)");
  const isMobile = propIsMobile ?? mediaQueryIsMobile;
  const baseUrls = baseUrl ? [baseUrl] : [];

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialActiveTab || "settings");
    }
  }, [initialActiveTab, isOpen]);

  if (!isOpen) return null;

  const tabButtonBase =
    "px-4 py-2 text-sm font-medium shrink-0 whitespace-nowrap cursor-pointer";

  const renderActiveTab = () => {
    switch (activeTab) {
      case "settings":
        return <GeneralTab logout={logout} router={router} onClose={onClose} />;
      case "models":
        return (
          <ModelsTab
            models={models}
            configuredModels={configuredModels}
            toggleConfiguredModel={toggleConfiguredModel}
            setConfiguredModels={setConfiguredModels}
            modelProviderMap={modelProviderMap}
            setModelProviderFor={setModelProviderFor}
            fetchModels={fetchModels}
          />
        );
      case "history":
        return (
          <HistoryTab
            setTransactionHistory={setTransactionHistory}
            clearConversations={clearConversations}
            onClose={onClose}
          />
        );
      case "api-keys":
        return (
          <ApiKeysTab
            baseUrl={baseUrl}
            baseUrls={baseUrls}
            setActiveTab={setActiveTab}
            isMobile={isMobile}
          />
        );
      case "wallet":
        return (
          <UnifiedWallet
            balance={balance}
            setBalance={setBalance}
            baseUrl={baseUrl}
            mintUrl={DEFAULT_MINT_URL}
            transactionHistory={transactionHistory}
            setTransactionHistory={setTransactionHistory}
          />
        );
      default:
        return null;
    }
  };

  const contentBody = (
    <>
      <div className="bg-card flex justify-between items-center p-4 shrink-0">
        <h2 className="text-xl font-semibold text-foreground">Settings</h2>
        <CloseButton
          onClick={onClose}
          className="text-foreground/70 hover:text-foreground"
          iconClassName="h-5 w-5"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0 overflow-x-auto">
        {SETTINGS_TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              className={`${tabButtonBase} ${
                isActive
                  ? "text-foreground border-b-2 border-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="p-4 flex-1 overflow-y-auto">{renderActiveTab()}</div>
    </>
  );

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent className="bg-card flex flex-col rounded-t-[10px] mt-24 h-[80%] lg:h-fit max-h-[96%] outline-none z-60">
          <div className="pt-4 pb-4 bg-card rounded-t-[10px] flex-1 overflow-y-auto">
            <DrawerTitle className="sr-only">Settings</DrawerTitle>
            <div className="max-w-2xl mx-auto flex flex-col h-full">
              {contentBody}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      overlayClassName="bg-black/70 backdrop-blur-sm z-50"
      contentClassName="bg-card rounded-lg overflow-hidden w-screen h-dvh m-0 sm:max-w-2xl sm:h-[80vh] sm:m-4 border border-border shadow-lg flex flex-col"
      contentStyle={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      closeOnOverlayClick
    >
      {contentBody}
    </ModalShell>
  );
};

export default SettingsModal;
