# Migration Plan: useCashuWallet.ts - useCurrentUser to useAccountManager

## Overview

Migrate `features/wallet/hooks/useCashuWallet.ts` from using `useCurrentUser` hook to the `useAccountManager` pattern with `activeAccount`.

## Current vs Target Pattern

### Current Pattern (NUser from useCurrentUser)
```typescript
import { useCurrentUser } from "@/hooks/useCurrentUser";

const { user } = useCurrentUser();

// Accessing pubkey
user.pubkey

// NIP-44 encryption/decryption
user.signer.nip44.encrypt(pubkey, plaintext)
user.signer.nip44.decrypt(pubkey, ciphertext)

// Signing events
user.signer.signEvent(template)
```

### Target Pattern (IAccount from useAccountManager)
```typescript
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";

const { manager } = useAccountManager();
const activeAccount = useObservableState(manager.active$);

// Accessing pubkey
activeAccount.pubkey

// NIP-44 encryption/decryption (directly on account, not nested in signer)
activeAccount.nip44?.encrypt(pubkey, plaintext)
activeAccount.nip44?.decrypt(pubkey, ciphertext)

// Signing events (directly on account)
activeAccount.signEvent(template)
```

## Key API Differences

| Operation | NUser (Current) | IAccount (Target) |
|-----------|-----------------|-------------------|
| Public key | `user.pubkey` | `activeAccount.pubkey` |
| NIP-44 encrypt | `user.signer.nip44.encrypt()` | `activeAccount.nip44?.encrypt()` |
| NIP-44 decrypt | `user.signer.nip44.decrypt()` | `activeAccount.nip44?.decrypt()` |
| Sign event | `user.signer.signEvent()` | `activeAccount.signEvent()` |
| Check NIP-44 support | `user.signer.nip44` | `activeAccount.nip44` |

## Line-by-Line Changes Required

### Import Changes
**Line 2:** Replace import
```typescript
// FROM:
import { useCurrentUser } from "@/hooks/useCurrentUser";

// TO:
import { useAccountManager } from "@/components/ClientProviders";
import { useObservableState } from "applesauce-react/hooks";
```

### Hook Initialization
**Line 80:** Replace hook call
```typescript
// FROM:
const { user } = useCurrentUser();

// TO:
const { manager } = useAccountManager();
const activeAccount = useObservableState(manager.active$);
```

### useEffect Dependencies
**Lines 92-102:** Update pubkey access and dependency
```typescript
// FROM:
useEffect(() => {
  if (user?.pubkey) {
    cashuUserPubkey$.next(user.pubkey);
    // ...
  }
}, [user?.pubkey]);

// TO:
useEffect(() => {
  if (activeAccount?.pubkey) {
    cashuUserPubkey$.next(activeAccount.pubkey);
    // ...
  }
}, [activeAccount?.pubkey]);
```

### Query Key Updates
**Lines 111, 225, 286-291, 303, 440, 558-561:** Update query keys
```typescript
// FROM:
queryKey: ["cashu", "wallet", user?.pubkey],
enabled: !!user,

// TO:
queryKey: ["cashu", "wallet", activeAccount?.pubkey],
enabled: !!activeAccount,
```

### NIP-44 Checks
**Lines 160-165, 234-235, 350-351, 456-457:** Update NIP-44 availability check
```typescript
// FROM:
if (!user.signer.nip44) {
  throw new Error("NIP-44 encryption not supported by your signer");
}

// TO:
if (!activeAccount.nip44) {
  throw new Error("NIP-44 encryption not supported by your signer");
}
```

### Decryption Calls
**Lines 163-165, 356-359:** Update decrypt calls
```typescript
// FROM:
const decrypted = await user.signer.nip44.decrypt(
  user.pubkey,
  event.content
);

// TO:
const decrypted = await activeAccount.nip44.decrypt(
  activeAccount.pubkey,
  event.content
);
```

### Encryption Calls
**Lines 250-254, 496-499:** Update encrypt calls
```typescript
// FROM:
const content = await user.signer.nip44.encrypt(
  user.pubkey,
  JSON.stringify(tags)
);

// TO:
const content = await activeAccount.nip44.encrypt(
  activeAccount.pubkey,
  JSON.stringify(tags)
);
```

### Sign Event Calls
**Lines 257-262, 502-507, 535-540:** Update signEvent calls
```typescript
// FROM:
const event = await user.signer.signEvent({
  kind: CASHU_EVENT_KINDS.WALLET,
  content,
  tags: [],
  created_at: Math.floor(Date.now() / 1000),
});

// TO:
const event = await activeAccount.signEvent({
  kind: CASHU_EVENT_KINDS.WALLET,
  content,
  tags: [],
  created_at: Math.floor(Date.now() / 1000),
});
```

### User Existence Checks
**Lines 113, 233, 305, 455:** Update null checks
```typescript
// FROM:
if (!user) {
  return null;
}
if (!user) throw new Error("User not logged in");

// TO:
if (!activeAccount) {
  return null;
}
if (!activeAccount) throw new Error("User not logged in");
```

### getCashuWalletEvents / getCashuTokenEvents Calls
**Lines 134, 325:** Update pubkey parameter
```typescript
// FROM:
const events = getCashuWalletEvents(user.pubkey);
const events = getCashuTokenEvents(user.pubkey);

// TO:
const events = getCashuWalletEvents(activeAccount.pubkey);
const events = getCashuTokenEvents(activeAccount.pubkey);
```

## Additional Considerations

### Type Safety
- `activeAccount` is of type `IAccount | undefined` (from `useObservableState`)
- Need to handle the undefined case similar to current `user` handling
- `activeAccount.nip44` is optional, so keep the `?.` optional chaining

### Query Invalidation
The query invalidation patterns should work the same since they reference `activeAccount?.pubkey`:
```typescript
queryClient.invalidateQueries({
  queryKey: ["cashu", "wallet", activeAccount?.pubkey],
});
```

## Related Files Using Same Pattern

These files also use `useCurrentUser` and could be migrated using the same pattern:
- `hooks/useInvoiceSync.ts`
- `hooks/useApiKeysSync.ts`
- `hooks/useProviderBalancesSync.ts`
- `features/wallet/hooks/useCashuHistory.ts`
- `features/wallet/hooks/useNutzaps.ts`
- `features/wallet/hooks/useCreateCashuWallet.ts`

## Testing Checklist

After migration, verify:
- [ ] Wallet query fetches correctly when account is active
- [ ] Token query fetches correctly when account is active
- [ ] Wallet creation works with NIP-44 encryption and event signing
- [ ] Token updates work (proof mutations)
- [ ] Query invalidation triggers properly after mutations
- [ ] No TypeScript errors related to IAccount interface
- [ ] Cashu sync activates when activeAccount changes
