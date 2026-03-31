"use client";

import { useMemo, useState } from "react";
import { nip19 } from "nostr-tools";
import {
  ChevronDown,
  Key,
  LogOut,
  Plus,
  Settings,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { useAccountManager } from "@/components/ClientProviders";
import { useNostrProfiles } from "@/hooks/useNostrProfiles";
import { useChat } from "@/context/ChatProvider";
import { formatSatsVerbose } from "@/utils/walletUtils";
import { getScopedStorageKey } from "@/utils/accountScope";
const WALLET_BALANCE_STORAGE_KEY = "wallet_balance_sats";

interface SidebarProfileMenuProps {
  onOpenSettings: () => void;
  onOpenApiKeys: () => void;
  onAddAccount: () => void;
  onAfterAction?: () => void;
}

const shortenPubkey = (pubkey?: string): string => {
  if (!pubkey) return "Unknown";
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`;
};

const getNpubLabel = (pubkey?: string): string => {
  if (!pubkey) return "npub unavailable";

  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}...${npub.slice(-6)}`;
  } catch {
    return shortenPubkey(pubkey);
  }
};

const AccountAvatar = ({
  name,
  picture,
  sizeClassName = "h-11 w-11",
  textClassName = "text-base",
}: {
  name: string;
  picture?: string;
  sizeClassName?: string;
  textClassName?: string;
}) => {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";

  if (picture) {
    return (
      <img
        src={picture}
        alt={name}
        className={`${sizeClassName} rounded-full object-cover border border-sidebar-border bg-sidebar-accent/50`}
      />
    );
  }

  return (
    <div
      className={`${sizeClassName} rounded-full bg-amber-400 text-black flex items-center justify-center font-semibold ${textClassName}`}
    >
      {initial}
    </div>
  );
};

const MenuRow = ({
  icon,
  label,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors cursor-pointer"
  >
    <span className="text-sidebar-foreground/80">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[15px] leading-5">{label}</span>
      {detail && (
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {detail}
        </span>
      )}
    </span>
  </button>
);

const getStoredAccountBalanceSats = (identityId?: string | null): number => {
  if (typeof window === "undefined" || !identityId) {
    return 0;
  }

  try {
    const raw = window.localStorage.getItem(
      getScopedStorageKey(WALLET_BALANCE_STORAGE_KEY, identityId)
    );
    if (!raw) {
      return 0;
    }

    const parsed = JSON.parse(raw);
    return Math.max(
      0,
      Math.floor(typeof parsed === "number" ? parsed : Number(parsed) || 0)
    );
  } catch {
    return 0;
  }
};

export default function SidebarProfileMenu({
  onOpenSettings,
  onOpenApiKeys,
  onAddAccount,
  onAfterAction,
}: SidebarProfileMenuProps) {
  const { accounts, activeAccount, switchLogin, signOutActive } =
    useAccountManager();
  const { balance, isWalletLoading } = useChat();
  const [open, setOpen] = useState(false);
  const accountPubkeys = useMemo(
    () => accounts.map((account) => account.pubkey),
    [accounts]
  );

  const profiles = useNostrProfiles(accountPubkeys);

  if (!activeAccount) {
    return null;
  }

  const activeProfile = profiles[activeAccount.pubkey];
  const activeName =
    activeProfile?.name ||
    activeAccount.metadata?.name ||
    shortenPubkey(activeAccount.pubkey);
  const activeNpub = getNpubLabel(activeAccount.pubkey);
  const activeBalanceSats = isWalletLoading
    ? getStoredAccountBalanceSats(activeAccount.pubkey)
    : Math.max(0, Math.floor(balance));
  const activeBalanceLabel = formatSatsVerbose(activeBalanceSats);
  const otherAccounts = accounts.filter((account) => account.id !== activeAccount.id);
  const accountBalanceLabels = useMemo(() => {
    const labels: Record<string, string> = {};

    for (const account of accounts) {
      const satsBalance =
        account.id === activeAccount.id
          ? activeBalanceSats
          : getStoredAccountBalanceSats(account.pubkey);

      labels[account.id] = formatSatsVerbose(satsBalance);
    }

    return labels;
  }, [accounts, activeAccount.id, activeBalanceSats, open]);

  const runAction = async (action: () => Promise<void> | void) => {
    await action();
    setOpen(false);
    onAfterAction?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2.5 rounded-[18px] border border-sidebar-border bg-sidebar-accent/30 hover:bg-sidebar-accent/50 px-2.5 py-2.5 text-left text-sidebar-foreground transition-colors cursor-pointer"
        >
          <AccountAvatar
            name={activeName}
            picture={activeProfile?.picture}
            sizeClassName="h-9 w-9"
            textClassName="text-sm"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-5">
              {activeName}
            </div>
            <div className="truncate text-[11px] font-mono text-muted-foreground">
              {activeNpub}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full border border-sidebar-border/80 bg-sidebar-accent/40 px-2 py-0.5 text-[10px] leading-4 text-muted-foreground">
              {activeBalanceLabel}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[296px] rounded-[26px] border-sidebar-border bg-[rgba(36,36,36,0.96)] p-2.5 shadow-2xl backdrop-blur-xl"
      >
        <div className="space-y-1.5">
          <div className="flex items-start gap-3 rounded-[20px] px-2.5 py-2">
            <AccountAvatar
              name={activeName}
              picture={activeProfile?.picture}
              sizeClassName="h-10 w-10"
              textClassName="text-sm"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium leading-5 text-sidebar-foreground">
                {activeName}
              </div>
              <div className="truncate text-[11px] font-mono leading-4 text-muted-foreground">
                {activeNpub}
              </div>
            </div>
            <span className="rounded-full border border-sidebar-border/80 bg-sidebar-accent/40 px-2 py-0.5 text-[10px] leading-4 text-muted-foreground">
              {activeBalanceLabel}
            </span>
          </div>

          <div className="my-1.5 h-px bg-white/12" />

          <MenuRow
            icon={<Settings className="h-5 w-5" />}
            label="Settings"
            onClick={() => void runAction(() => onOpenSettings())}
          />
          <MenuRow
            icon={<Key className="h-5 w-5" />}
            label="API Keys"
            onClick={() => void runAction(() => onOpenApiKeys())}
          />

          {otherAccounts.length > 0 && (
            <>
              <div className="my-1.5 h-px bg-white/12" />
              <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Switch account
              </div>
              <div className="space-y-1">
                {otherAccounts.map((account) => {
                  const profile = profiles[account.pubkey];
                  const name =
                    profile?.name ||
                    account.metadata?.name ||
                    shortenPubkey(account.pubkey);
                  const npubLabel = getNpubLabel(account.pubkey);
                  const accountBalanceLabel =
                    accountBalanceLabels[account.id] ?? formatSatsVerbose(0);

                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() =>
                        void runAction(async () => {
                          await switchLogin(account.id);
                        })
                      }
                      className="w-full flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors cursor-pointer"
                    >
                      <AccountAvatar
                        name={name}
                        picture={profile?.picture}
                        sizeClassName="h-8 w-8"
                        textClassName="text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium leading-5">
                          {name}
                        </div>
                        <div className="truncate text-[11px] font-mono leading-4 text-muted-foreground">
                          {npubLabel}
                        </div>
                      </div>
                      <span className="rounded-full border border-sidebar-border/80 bg-sidebar-accent/40 px-2 py-0.5 text-[10px] leading-4 text-muted-foreground">
                        {accountBalanceLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAddAccount();
                  onAfterAction?.();
                }}
                className="mt-1 w-full flex items-center gap-2.5 rounded-[16px] bg-white/10 hover:bg-white/14 px-3 py-2 text-left text-sidebar-foreground transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-[14px] leading-5">Add another account</span>
              </button>
            </>
          )}

          {otherAccounts.length === 0 && (
            <>
              <div className="my-1.5 h-px bg-white/12" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAddAccount();
                  onAfterAction?.();
                }}
                className="w-full flex items-center gap-2.5 rounded-[16px] bg-white/10 hover:bg-white/14 px-3 py-2 text-left text-sidebar-foreground transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-[14px] leading-5">Add another account</span>
              </button>
            </>
          )}

          <div className="my-1.5 h-px bg-white/12" />

          <MenuRow
            icon={<LogOut className="h-5 w-5" />}
            label="Log out"
            onClick={() =>
              void runAction(async () => {
                if (!window.confirm("Are you sure you want to sign out?")) {
                  return;
                }
                await signOutActive();
              })
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
