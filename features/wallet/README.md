# Wallet Feature

> Self-contained Cashu ecash wallet with NIP-60 Nostr integration

## Overview

The wallet feature provides a complete Cashu ecash wallet implementation with Lightning Network support and optional Nostr NIP-60 storage.

**Key Features:**
- ✅ Send and receive Cashu tokens
- ✅ Lightning Network integration (mint/melt)
- ✅ Multi-mint support
- ✅ NIP-60 Nostr storage (encrypted proofs)
- ✅ NIP-61 Nutzap support
- ✅ P2PK locked proofs
- ✅ Framework-agnostic core (can be used without React)

## Architecture

```
wallet/
├── core/                    # Pure business logic (no React)
│   ├── domain/             # Types and interfaces
│   ├── services/           # Business logic services
│   └── utils/              # Pure utility functions
├── infrastructure/         # External dependencies (planned)
│   ├── api/               # API clients
│   ├── storage/           # Storage adapters
│   └── nostr/             # Nostr integration
├── state/                  # State management (Zustand)
├── hooks/                  # React hooks
└── components/            # UI components
```

## Usage

### In React Components

```typescript
import { useCashuWallet, useCashuToken } from '@/features/wallet';

function MyWalletComponent() {
  const { wallet, balance, isLoading } = useCashuWallet();
  const { sendToken, receiveToken } = useCashuToken();

  // Send 100 sats
  const handleSend = async () => {
    const { proofs, unit } = await sendToken('https://mint.example.com', 100);
    console.log('Token sent:', proofs);
  };

  return <div>Balance: {balance} sats</div>;
}
```

### Using Services Directly (No React)

```typescript
import { MintService, TokenService, LightningService } from '@/features/wallet';

// Create service instances
const mintService = new MintService();
const tokenService = new TokenService();
const lightningService = new LightningService();

// Activate a mint
const { mintInfo, keysets } = await mintService.activateMint('https://mint.example.com');

// Create a Lightning invoice
const quote = await lightningService.createMintQuote('https://mint.example.com', 1000);
console.log('Pay this invoice:', quote.paymentRequest);

// Decode a token
const token = 'cashuA...';
const decoded = tokenService.decodeToken(token);
console.log('Token amount:', tokenService.getTokenAmount(token));
```

### Using Utilities

```typescript
import { formatBalance, calculateProofsBalance, canMakeExactChange } from '@/features/wallet';

// Format balance
const formatted = formatBalance(100000, 'sat'); // "100k sat"

// Calculate balance from proofs
const balance = calculateProofsBalance(proofs);

// Check if exact change is possible
const { canMake, selectedProofs } = canMakeExactChange(1000, denomCounts, proofs);
```

## Core Services

### MintService

Handles all mint-related operations.

```typescript
const mintService = new MintService();

// Activate a mint (fetch info and keysets)
const { mintInfo, keysets } = await mintService.activateMint(mintUrl);

// Update mint keys
const { keys } = await mintService.updateMintKeys(mintUrl, keysets);

// Get preferred unit
const unit = await mintService.getPreferredUnit(mintUrl); // 'sat' | 'msat'

// Validate mint URL
const isValid = mintService.validateMintUrl(url);
```

### TokenService

Handles token encoding/decoding and parsing.

```typescript
const tokenService = new TokenService();

// Decode a token
const decoded = tokenService.decodeToken('cashuA...');

// Encode proofs into a token
const token = tokenService.encodeToken(mintUrl, proofs, 'sat');

// Get token amount
const amount = tokenService.getTokenAmount(token);

// Validate token
const isValid = tokenService.isValidToken(token);
```

### LightningService

Handles Lightning Network operations.

```typescript
const lightningService = new LightningService();

// Create a mint quote (receive)
const quote = await lightningService.createMintQuote(mintUrl, 1000);

// Mint tokens after payment
const proofs = await lightningService.mintTokensFromPaidInvoice(
  mintUrl,
  quote.quoteId,
  1000
);

// Create a melt quote (send)
const meltQuote = await lightningService.createMeltQuote(mintUrl, invoice);

// Parse invoice amount
const amount = lightningService.parseInvoiceAmount(invoice);
```

## State Management

The wallet uses Zustand for state management:

```typescript
import { useCashuStore, useNutzapStore } from '@/features/wallet';

// Access store
const cashuStore = useCashuStore();
const mints = cashuStore.mints;
const proofs = cashuStore.proofs;

// Add a mint
cashuStore.addMint('https://mint.example.com');

// Add proofs
cashuStore.addProofs(proofs, eventId);

// Get proofs for a mint
const mintProofs = await cashuStore.getMintProofs(mintUrl);
```

## Available Hooks

- `useCashuWallet()` - Main wallet hook (fetch wallet data, create wallet)
- `useCashuToken()` - Send/receive tokens
- `useCreateCashuWallet()` - Create a new wallet
- `useNutzaps()` - NIP-61 nutzap operations
- `useCashuHistory()` - Transaction history
- `useWalletOperations()` - Legacy wallet operations

## Components

- `<DepositModal />` - Modal for depositing funds
- `<SixtyWallet />` - NIP-60 wallet UI
- `<WalletTab />` - Wallet settings tab
- `<UnifiedWallet />` - Unified wallet view
- `<InvoiceHistory />` - Invoice history display
- `<InvoiceModal />` - Invoice display modal

## Domain Models

### Proof
```typescript
interface Proof {
  id: string;
  amount: number;
  secret: string;
  C: string;
}
```

### CashuToken
```typescript
interface CashuToken {
  mint: string;
  proofs: Proof[];
  del?: string[];
  unit?: string;
}
```

### Wallet
```typescript
interface Wallet {
  privkey: string;
  mints: string[];
}
```

### Transaction
```typescript
interface Transaction {
  type: TransactionType;
  amount: number;
  timestamp: number;
  status: TransactionStatus;
  message?: string;
  balance?: number;
}
```

## Extracting for Other Projects

The wallet feature is designed to be easily extracted and used in other projects:

### Option 1: Copy the Folder

```bash
# Copy the entire wallet feature
cp -r features/wallet /path/to/other-project/src/features/

# Install dependencies
npm install @cashu/cashu-ts @cashu/crypto zustand
```

### Option 2: Use Core Services Only (No React)

```typescript
// Just copy the core/ directory
features/wallet/core/
├── domain/
├── services/
└── utils/

// Use in any JavaScript/TypeScript project
import { MintService, TokenService } from './wallet/core/services';
```

### Option 3: Publish as NPM Package

```json
{
  "name": "@yourorg/cashu-wallet",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/core/index.js",
    "./react": "./dist/hooks/index.js"
  }
}
```

## Testing

```typescript
// Test core services (no React needed)
import { TokenService } from '@/features/wallet';

describe('TokenService', () => {
  it('should decode token correctly', () => {
    const service = new TokenService();
    const decoded = service.decodeToken(mockToken);
    expect(decoded.mint).toBe('https://mint.example.com');
  });
});

// Test React hooks
import { renderHook } from '@testing-library/react';
import { useCashuWallet } from '@/features/wallet';

it('should fetch wallet', async () => {
  const { result } = renderHook(() => useCashuWallet());
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});
```

## Configuration

Default mints:
```typescript
import { defaultMints } from '@/features/wallet';
// ['https://mint.minibits.cash/Bitcoin']
```

## Dependencies

**Required:**
- `@cashu/cashu-ts` - Cashu protocol implementation
- `@cashu/crypto` - Cryptographic primitives
- `zustand` - State management

**Optional (for React):**
- `react`
- `@tanstack/react-query`

**Optional (for Nostr):**
- `nostr-tools`
- `@nostrify/nostrify`

## Future Enhancements

- [ ] Add infrastructure adapters (abstract storage layer)
- [ ] Add comprehensive tests
- [ ] Add proof backup/recovery
- [ ] Add multi-currency support
- [ ] Publish as standalone npm package

## Contributing

When contributing to the wallet feature:

1. **Keep core/ pure** - No React, no external state
2. **Services should be testable** - Inject dependencies
3. **Document public APIs** - Add JSDoc comments
4. **Follow the architecture** - Domain → Services → Infrastructure → UI

## License

Same as the parent project.

