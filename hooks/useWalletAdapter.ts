import { useEffect, useMemo, useRef } from "react";
import { getDecodedToken } from "@cashu/cashu-ts";
import type { WalletAdapter } from "@routstr/sdk/wallet";
import { DEFAULT_MINT_URL } from "@/lib/utils";

interface WalletAdapterSource {
  mintBalances: Record<string, number>;
  mintUnits: Record<string, string>;
  cashuStore: {
    activeMintUrl?: string | null;
    getActiveMintUrl?: () => string | null | undefined;
  };
  sendToken: (
    mintUrl: string,
    amount: number,
    p2pkPubkey?: string,
    unit?: string,
    options?: { isUserSend?: boolean }
  ) => Promise<string>;
  receiveToken: (token: string) => Promise<{ amount: number }[]>;
}

export function useWalletAdapter(
  source: WalletAdapterSource | null
): WalletAdapter | null {
  const sourceRef = useRef<WalletAdapterSource | null>(source);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  return useMemo(() => {
    if (!sourceRef.current) return null;

    const adapter: WalletAdapter = {
      async getBalances() {
        return sourceRef.current?.mintBalances ?? {};
      },
      getMintUnits() {
        const units = sourceRef.current?.mintUnits ?? {};
        const normalized: Record<string, "sat" | "msat"> = {};
        for (const [mintUrl, unit] of Object.entries(units)) {
          normalized[mintUrl] = unit === "msat" ? "msat" : "sat";
        }
        return normalized;
      },
      getActiveMintUrl() {
        const active =
          sourceRef.current?.cashuStore.getActiveMintUrl?.() ??
          sourceRef.current?.cashuStore.activeMintUrl;
        return active ?? DEFAULT_MINT_URL;
      },
      async sendToken(mintUrl: string, amount: number, p2pkPubkey?: string) {
        const activeSource = sourceRef.current;
        if (!activeSource) {
          throw new Error("Wallet adapter is not initialized");
        }
        // The adapter's sendToken is consumed by the Routstr SDK client to mint
        // tokens that pay the API (an API spend): the SDK owns the token and its
        // refund/recovery. Mark it isUserSend:false so no recoverable
        // pending_send_proofs_* backup is left behind for recoverPendingProofs()
        // to re-credit on reload (double-credit / "proofs already spent").
        return activeSource.sendToken(mintUrl, amount, p2pkPubkey, undefined, {
          isUserSend: false,
        });
      },
      async receiveToken(token: string) {
        const activeSource = sourceRef.current;
        if (!activeSource) {
          return {
            success: false,
            amount: 0,
            unit: "sat" as const,
            message: "Wallet adapter is not initialized",
          };
        }

        const decoded = getDecodedToken(token);
        const fallbackUnit = decoded?.unit === "msat" ? "msat" : "sat";

        try {
          const proofs = await activeSource.receiveToken(token);
          const amount = proofs.reduce((sum, proof) => sum + proof.amount, 0);
          return {
            success: true,
            amount,
            unit: fallbackUnit,
          };
        } catch (error) {
          return {
            success: false,
            amount: 0,
            unit: fallbackUnit,
            message:
              error instanceof Error
                ? error.message
                : "Failed to receive token",
          };
        }
      },
    };

    return adapter;
  }, [Boolean(source)]);
}
