/**
 * Wallet Feature - Public API
 * 
 * This is the main entry point for the wallet feature.
 * Import from this file to use wallet functionality in your app.
 * 
 * @example
 * ```typescript
 * // Use React hooks
 * import { useCashuWallet, useCashuToken } from '@/features/wallet';
 * 
 * // Use services directly (framework-agnostic)
 * import { MintService, TokenService } from '@/features/wallet';
 * 
 * // Use domain types
 * import type { Wallet, Proof, CashuToken } from '@/features/wallet';
 * ```
 */

// Domain Models (Types)
export type * from './core/domain';

// Core Services (Framework-agnostic business logic)
export * from './core/services';

// Core Utilities (Pure functions)
export * from './core/utils';

// State Management (Zustand stores)
export * from './state';

// React Hooks (React integration)
export * from './hooks';

// UI Components (React components)
export * from './components';

// Constants
export { defaultMints } from './core/services/MintService';

