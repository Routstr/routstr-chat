"use client";

import { useCallback, useEffect, useState } from "react";

export type BitcoinConnectStatus = "disconnected" | "connecting" | "connected";

type BitcoinConnectModule = typeof import("@getalby/bitcoin-connect-react");

let bitcoinConnectModulePromise: Promise<BitcoinConnectModule> | null = null;

const getBitcoinConnectModule = async (): Promise<BitcoinConnectModule> => {
  if (!bitcoinConnectModulePromise) {
    bitcoinConnectModulePromise = import("@getalby/bitcoin-connect-react");
  }
  return bitcoinConnectModulePromise;
};

const getProviderName = (cfg: unknown): string | null => {
  if (!cfg || typeof cfg !== "object") return null;
  const name = "name" in cfg ? (cfg as { name?: unknown }).name : undefined;
  return typeof name === "string" && name.trim() ? name : null;
};

export const fetchBitcoinConnectBalance = async (
  provider: any
): Promise<number | null> => {
  try {
    if (!provider || typeof provider.getBalance !== "function") {
      return null;
    }

    const res = await provider.getBalance();
    if (typeof res === "number") return res;
    if (!res || typeof res !== "object") return null;

    if ("balance" in res && typeof (res as any).balance === "number") {
      const unit = ((res as any).unit || "").toString().toLowerCase();
      const n = (res as any).balance as number;
      return unit.includes("msat") ? Math.floor(n / 1000) : n;
    }

    if ("balanceMsats" in res && typeof (res as any).balanceMsats === "number") {
      return Math.floor((res as any).balanceMsats / 1000);
    }
  } catch {}

  return null;
};

export const requestBitcoinConnectProvider = async () => {
  const mod = await getBitcoinConnectModule();
  return mod.requestProvider();
};

const launchBitcoinConnectModal = async () => {
  const mod = await getBitcoinConnectModule();
  return mod.launchModal();
};

const disconnectBitcoinConnect = async () => {
  const mod = await getBitcoinConnectModule();
  return mod.disconnect();
};

export const useBitcoinConnectStatus = () => {
  const [status, setStatus] = useState<BitcoinConnectStatus>("disconnected");
  const [balance, setBalance] = useState<number | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);

  const connect = useCallback(async () => {
    try {
      await launchBitcoinConnectModal();
    } catch {}
  }, [launchBitcoinConnectModal]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectBitcoinConnect();
    } catch {}
  }, [disconnectBitcoinConnect]);

  const reset = useCallback(() => {
    setStatus("disconnected");
    setBalance(null);
    setProviderName(null);
  }, []);

  const refreshBalance = useCallback(async () => {
    try {
      const provider = await requestBitcoinConnectProvider();
      const sats = await fetchBitcoinConnectBalance(provider);
      if (sats !== null) {
        setBalance(sats);
      }
    } catch {}
  }, [requestBitcoinConnectProvider, fetchBitcoinConnectBalance]);

  useEffect(() => {
    let cancelled = false;
    let unsubConnect: undefined | (() => void);
    let unsubDisconnect: undefined | (() => void);
    let unsubConnecting: undefined | (() => void);

    const setProviderFromConfig = (cfg: unknown) => {
      if (cancelled) return;
      setProviderName(getProviderName(cfg));
    };

    const updateBalance = async (provider: any) => {
      const sats = await fetchBitcoinConnectBalance(provider);
      if (!cancelled && sats !== null) {
        setBalance(sats);
      }
    };

    (async () => {
      try {
        const mod = await getBitcoinConnectModule();

        unsubConnecting = mod.onConnecting?.(() => {
          if (!cancelled) setStatus("connecting");
        });
        unsubConnect = mod.onConnected?.(async (provider: any) => {
          if (cancelled) return;
          setStatus("connected");
          setProviderFromConfig(mod.getConnectorConfig?.());
          await updateBalance(provider);
        });
        unsubDisconnect = mod.onDisconnected?.(() => {
          if (!cancelled) reset();
        });

        try {
          const cfg = mod.getConnectorConfig?.();
          if (cfg) {
            if (cancelled) return;
            setStatus("connected");
            setProviderFromConfig(cfg);
            try {
              const provider = await mod.requestProvider();
              await updateBalance(provider);
            } catch {}
          }
        } catch {}
      } catch {}
    })();

    return () => {
      cancelled = true;
      try {
        unsubConnect && unsubConnect();
      } catch {}
      try {
        unsubDisconnect && unsubDisconnect();
      } catch {}
      try {
        unsubConnecting && unsubConnecting();
      } catch {}
    };
  }, [fetchBitcoinConnectBalance, getBitcoinConnectModule, getProviderName, reset]);

  return {
    status,
    balance,
    providerName,
    connect,
    disconnect,
    refreshBalance,
    reset,
  };
};
