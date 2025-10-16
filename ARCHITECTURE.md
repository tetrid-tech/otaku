# Architecture: Embedded Auth + Server Wallet

## Overview

This architecture combines the **best of both worlds**:
- ✅ Users authenticate via **CDP Embedded Wallet** (email/SMS)
- ✅ Backend manages **CDP Server Wallet** for each user
- ✅ AI agent can **autonomously execute transactions**
- ✅ User never needs to approve transactions (AI is trusted)

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER SIGNS IN                           │
│                  (CDP Embedded Wallet Auth)                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
                  Frontend gets userId
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              POST /api/wallet/sync { userId }                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend: cdpService.getOrCreateAccount({ name: userId })       │
│  - If new user → Create server wallet                           │
│  - If existing → Return existing wallet                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
                Returns wallet address
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
   Frontend Display              AI Agent Access
   - Balance                     - Auto trade
   - Tokens                      - Auto transfer
   - NFTs                        - Auto swap
   - History                     - Portfolio mgmt
   (via backend APIs)            (via actions)
```

## Components

### 1. Frontend (React)

**Purpose**: User authentication + UI display

**CDP Package**: `@coinbase/cdp-hooks`

**Responsibilities**:
- ✅ User signs in with email/SMS (embedded wallet)
- ✅ Get `userId` from CDP
- ✅ Call backend API to sync server wallet
- ✅ Display wallet info from backend APIs
- ❌ Does NOT sign transactions (AI agent does)

**Code**:
```typescript
// When user signs in
const { currentUser } = useCurrentUser();
const { isSignedIn } = useIsSignedIn();

useEffect(() => {
  if (isSignedIn && currentUser?.id) {
    // Sync server wallet
    elizaClient.wallet.sync(currentUser.id);
  }
}, [isSignedIn, currentUser]);

// Display wallet info
const { data: walletInfo } = useQuery({
  queryKey: ['wallet-info', userId],
  queryFn: () => elizaClient.wallet.getInfo(userId),
});
```

### 2. Backend (Node.js)

**Purpose**: Wallet management + Transaction execution

**CDP Package**: `@coinbase/cdp-sdk`

**Responsibilities**:
- ✅ Create/manage server wallet per user
- ✅ Execute transactions autonomously
- ✅ Provide wallet info APIs
- ✅ Track balances, tokens, NFTs, history

**New APIs**:

#### **POST /api/wallet/sync**
```typescript
// Sync user's server wallet
POST /api/wallet/sync
Body: { userId: string }
Response: {
  walletAddress: string;
  isNew: boolean;
}
```

#### **GET /api/wallet/info/:userId**
```typescript
// Get comprehensive wallet info
GET /api/wallet/info/:userId
Response: {
  address: string;
  totalBalance: number;
  chains: {
    base: { balance: number, tokens: [...] },
    ethereum: { balance: number, tokens: [...] },
    polygon: { balance: number, tokens: [...] }
  }
}
```

#### **GET /api/wallet/tokens/:userId**
```typescript
// Get token balances
GET /api/wallet/tokens/:userId
Query: { chain?: 'base' | 'ethereum' | 'polygon' }
Response: {
  tokens: [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      balance: '1.5',
      usdValue: 3750,
      contractAddress: null,
      chain: 'base'
    }
  ]
}
```

#### **GET /api/wallet/nfts/:userId**
```typescript
// Get NFT holdings
GET /api/wallet/nfts/:userId
Response: {
  nfts: [
    {
      name: 'CryptoPunk #1234',
      collection: 'CryptoPunks',
      tokenId: '1234',
      image: 'https://...',
      chain: 'ethereum'
    }
  ]
}
```

#### **GET /api/wallet/history/:userId**
```typescript
// Get transaction history
GET /api/wallet/history/:userId
Response: {
  transactions: [
    {
      hash: '0x...',
      type: 'transfer',
      from: '0x...',
      to: '0x...',
      amount: '10',
      token: 'USDC',
      timestamp: '2025-01-15T10:30:00Z',
      chain: 'base'
    }
  ]
}
```

### 3. CDP Service (Updated)

**New Methods**:

```typescript
// cdp.service.ts

/**
 * Sync user's server wallet - creates if doesn't exist
 */
async syncUserWallet(userId: string): Promise<{
  address: string;
  isNew: boolean;
}> {
  if (!this.client) {
    throw new Error("CDP is not authenticated");
  }

  // Use userId as account name for consistency
  const account = await this.client.evm.getOrCreateAccount({
    name: userId,
  });

  return {
    address: account.address,
    isNew: false, // TODO: Track if newly created
  };
}

/**
 * Get comprehensive wallet info for a user
 */
async getWalletInfo(userId: string): Promise<{
  address: string;
  totalBalance: number;
  chains: Record<string, any>;
}> {
  // Implementation similar to cdp-wallet-info action
  // but for the server wallet
}

/**
 * Get token balances for a user
 */
async getTokenBalances(userId: string, chain?: string): Promise<TokenBalance[]> {
  // Fetch balances for server wallet
}

/**
 * Get NFTs for a user
 */
async getNFTs(userId: string): Promise<NFT[]> {
  // Fetch NFTs for server wallet
}

/**
 * Get transaction history for a user
 */
async getTransactionHistory(userId: string): Promise<Transaction[]> {
  // Fetch history for server wallet
}
```

### 4. Actions (Unchanged)

**Actions work on the server wallet**:

```typescript
// WALLET_TRANSFER action
const cdpService = runtime.getService(CdpService.serviceType);
const result = await cdpService.transfer({
  accountName: message.entityId, // This is the userId
  network: 'base',
  to: recipientAddress,
  token: 'usdc',
  amount: parseUnits('10', 6),
});
// ✅ Transaction is sent by AI agent autonomously
```

## Entity Metadata

Store wallet mapping in entity metadata:

```typescript
{
  id: userId,
  names: ['User'],
  metadata: {
    // Embedded wallet (for auth only)
    embeddedWalletAddress: '0x...',
    
    // Server wallet (for transactions)
    serverWalletAddress: '0x...',
    cdpAccountName: userId,
    
    // Other info
    email: 'user@example.com',
    createdAt: '2025-01-15T10:00:00Z'
  }
}
```

## Benefits

### ✅ **Security**
- User authenticates with CDP (proven security)
- Server wallet is isolated per user
- AI agent can only access user's own wallet

### ✅ **UX**
- User signs in once (email/SMS)
- No transaction approvals needed
- AI agent works autonomously

### ✅ **Scalability**
- Each user has their own server wallet
- Backend manages all wallets
- Easy to add new features

### ✅ **Flexibility**
- Can add transaction limits
- Can add approval workflows later
- Can track all AI actions

## Migration Steps

### Phase 1: Backend Setup ✅
1. Add `syncUserWallet` to CDP service
2. Create wallet sync API endpoint
3. Create wallet info API endpoints

### Phase 2: Frontend Integration
1. Call sync API when user signs in
2. Replace embedded wallet hooks with API calls
3. Update UI to use backend data

### Phase 3: Actions Update
1. Ensure actions use userId as account name
2. Update entity metadata structure
3. Test all actions (transfer, swap, etc.)

### Phase 4: Testing
1. Test sign in → wallet creation
2. Test wallet info display
3. Test AI agent transactions
4. Test multi-user isolation

## Security Considerations

### ✅ **Implemented**
- Each user has isolated server wallet
- Backend validates userId
- Actions check user permissions

### 🔒 **To Implement**
- Rate limiting on wallet APIs
- Transaction amount limits (optional)
- Audit log of all AI actions
- User notification of transactions (optional)

## Future Enhancements

### 💡 **Possible Features**
- Transaction approval workflow (optional)
- Multi-signature requirements
- Spending limits per day/week
- Whitelist of approved tokens
- Emergency pause button
- Transaction rollback (if possible)

## Comparison

| Feature | Embedded Wallet | Server Wallet | This Architecture |
|---------|-----------------|---------------|-------------------|
| **Auth** | ✅ User email/SMS | ❌ API keys only | ✅ User email/SMS |
| **Private Keys** | 🌐 Browser | ☁️ CDP servers | ☁️ CDP servers |
| **AI Autonomy** | ❌ Needs approval | ✅ Autonomous | ✅ Autonomous |
| **User Control** | ✅ Full control | ❌ No control | ⚖️ Trust-based |
| **Security** | ✅ User manages | ✅ CDP manages | ✅ CDP manages |
| **Scalability** | ❌ Browser only | ✅ Server-side | ✅ Server-side |

## Conclusion

This architecture provides:
- ✅ **Easy onboarding** (email/SMS login)
- ✅ **AI autonomy** (no approval needed)
- ✅ **User isolation** (per-user wallets)
- ✅ **Scalability** (server-managed)

Perfect for an AI trading agent! 🚀

