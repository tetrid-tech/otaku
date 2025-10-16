# Wallet Architecture - Embedded vs Server Wallets

## The Problem

There are **TWO DIFFERENT wallet architectures** in this codebase, and they are **INCOMPATIBLE**:

### 1. **Embedded Wallets** (Frontend Only)
- Used by the **frontend UI** (`CDPWalletCard`, `SendModal`, etc.)
- Private keys are stored **in the user's browser** via CDP's embedded wallet service
- Uses `@coinbase/cdp-hooks` (`useSendUserOperation`, `useEvmAddress`, etc.)
- The **backend CANNOT access these private keys**
- Transaction signing happens in the **frontend**

### 2. **Server Wallets** (Backend Only)
- Used by the **CDP Service** (`cdp.service.ts`)
- Private keys are managed by **Coinbase CDP servers** via API keys
- Uses `@coinbase/cdp-sdk` (`CdpClient`, `EvmServerAccount`, etc.)
- The **backend CAN sign transactions** using CDP API
- Transaction signing happens on **CDP's servers**

## The Contradiction

**You cannot have both:**
- ❌ **"Backend action must complete the transfer"** (requires server wallet)
- ❌ **"Must work with embedded wallets"** (private keys only in frontend)

**These are mutually exclusive.**

## Solutions

### Option A: Use Server Wallets for Actions ✅ (Current Implementation)

**How it works:**
1. User creates a wallet via `CDP_CREATE_WALLET` action
2. CDP service creates a **server-side wallet** using `CdpClient`
3. Wallet address is stored in entity metadata
4. Backend actions (`WALLET_TRANSFER`, `WALLET_SWAP`, etc.) can sign and send transactions
5. Frontend just displays the wallet info

**Pros:**
- ✅ Backend actions are fully autonomous
- ✅ No frontend involvement needed for transfers
- ✅ Works great for AI agents

**Cons:**
- ❌ User doesn't control private keys
- ❌ Wallet is tied to CDP service
- ❌ Requires CDP API keys

**Code:**
```typescript
// Backend action can sign and send
const result = await cdpService.transfer({
  accountName: message.entityId,
  network: 'base',
  to: recipientAddress,
  token: 'usdc',
  amount: parseUnits('10', 6),
});
// ✅ Transaction is SENT and returns txHash
```

### Option B: Use Embedded Wallets ❌ (Requires Frontend)

**How it works:**
1. User signs in with email via CDP embedded wallet (frontend)
2. Private key is stored in user's browser
3. Backend actions can only **prepare** transaction data
4. Frontend must **sign and send** the transaction

**Pros:**
- ✅ User controls their private keys
- ✅ Better security model
- ✅ No CDP API keys needed

**Cons:**
- ❌ Backend actions CANNOT complete transfers
- ❌ Requires frontend to handle transaction signing
- ❌ More complex flow

**Code:**
```typescript
// Backend action can ONLY prepare tx data
return {
  success: false,
  requiresFrontendSigning: true,
  transactionData: {
    to: recipientAddress,
    value: amount,
    data: '0x...',
  },
};

// Frontend MUST sign and send
const { sendUserOperation } = useSendUserOperation();
const hash = await sendUserOperation({
  calls: [transactionData],
});
```

### Option C: Hybrid Approach 🤔 (Complex)

**How it works:**
1. Check if user has a **server wallet** OR **embedded wallet**
2. If server wallet → Use CDP service to sign and send
3. If embedded wallet → Return tx data for frontend to sign

**Pros:**
- ✅ Supports both wallet types
- ✅ Maximum flexibility

**Cons:**
- ❌ Very complex implementation
- ❌ Confusing for users
- ❌ Two different code paths to maintain

## Current State

**Right now, you have BOTH architectures:**
- **Frontend**: Using embedded wallets (`@coinbase/cdp-hooks`)
- **Backend**: Using server wallets (`@coinbase/cdp-sdk`)
- **They are NOT connected!**

The `walletAddress` in entity metadata could come from either:
- Embedded wallet (stored when user signs in via frontend)
- Server wallet (created by `CDP_CREATE_WALLET` action)

## Recommendation

**You MUST choose ONE:**

### If you want **backend actions to complete transfers**:
1. ❌ **Remove all embedded wallet code** from frontend
2. ✅ **Use only server wallets** (CDP service)
3. ✅ **Keep current transfer action** (uses `cdpService.transfer()`)
4. Frontend just displays wallet info, doesn't sign transactions

### If you want **embedded wallets**:
1. ❌ **Backend actions cannot complete transfers**
2. ✅ **Backend prepares transaction data**
3. ✅ **Frontend signs with `useSendUserOperation`**
4. More code in frontend to handle transaction flows

## My Suggestion

**For an AI agent, use Server Wallets (Option A)**

Why?
- AI agents need to be autonomous
- Backend actions should complete tasks without frontend
- User doesn't need direct control of private keys
- CDP manages security and key storage

The current `WALLET_TRANSFER` action is correct for server wallets.

## What Needs To Change

If you want embedded wallets:
```typescript
// cdp-wallet-transfer.ts
return {
  success: false,
  requiresFrontendSigning: true,
  transactionData: { /* prepared tx */ },
  // Frontend will handle signing
};
```

If you want server wallets (recommended):
```typescript
// Keep current implementation
const result = await cdpService.transfer({
  accountName: message.entityId,
  network: transferParams.network,
  to: transferParams.to,
  token,
  amount,
});

return {
  success: true,
  transactionHash: result.transactionHash,
};
```

## Bottom Line

**You cannot have your cake and eat it too.** Pick one:
- 🎂 Backend completes transfers → Server wallets
- 🍰 Embedded wallets → Frontend signs transactions

