/**
 * Wallet Feature - Public API
 *
 * This is the main entry point for the wallet feature.
 * Import from this file to use wallet functionality in your app.
 *
 * @example
 * ```typescript
 * // Use React hooks
 * import { useWalletSend } from '@/features/wallet';
 *
 * // Use services directly (framework-agnostic)
 * import { MintService } from '@/features/wallet';
 *
 * // Use domain types
 * import type { Wallet, Proof, CashuToken } from '@/features/wallet';
 * ```
 */

// Domain Models (Types)
export type * from "./core/domain";

// Core Services (Framework-agnostic business logic)
export * from "./core/services/MintService";

// Core Utilities (Pure functions)
export * from "./core/utils/balance";
export * from "./core/utils/formatting";

// State Management (Zustand stores)
export * from "./state/nutzapStore";
export * from "./state/transactionHistoryStore";
export * from "./state/unclaimedTokensStore";

// React Hooks (React integration)
export { holdsRecords } from "./hooks/useBook";
export * from "./hooks/useCreateCashuWallet";
export * from "./hooks/useNutzaps";
export * from "./hooks/useCashuHistory";
export { useWalletSend } from "./hooks/useWalletSend";
export { useWalletReceive } from "./hooks/useWalletReceive";


// Constants
export { defaultMints } from "./core/services/MintService";
