# CDP Wallet API Endpoints

All CDP wallet operations are now handled on the backend via API endpoints. The frontend should call these endpoints instead of directly interacting with the wallet.

## Base URL
```
http://localhost:3050/api/cdp
```

## Endpoints

### 1. Get/Create Server Wallet
**POST** `/api/cdp/wallet`

Creates or retrieves a server-side CDP wallet for a user.

**Request Body:**
```json
{
  "name": "user-entity-id"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "0x...",
    "accountName": "user-entity-id"
  }
}
```

---

### 2. Get Token Balances
**GET** `/api/cdp/wallet/tokens/:name`

Fetches all token balances across **Base, Ethereum, and Polygon** networks with USD values.

**URL Parameters:**
- `name` - User's entity ID (account name)

**Response:**
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "symbol": "ETH",
        "name": "Ethereum",
        "balance": "1.5",
        "balanceFormatted": "1.5",
        "usdValue": 4500.0,
        "usdPrice": 3000.0,
        "contractAddress": null,
        "chain": "ethereum",
        "decimals": 18
      },
      {
        "symbol": "USDC",
        "name": "USD Coin",
        "balance": "1000.0",
        "balanceFormatted": "1000",
        "usdValue": 1000.0,
        "usdPrice": 1.0,
        "contractAddress": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "chain": "ethereum",
        "decimals": 6
      }
    ],
    "totalUsdValue": 5500.0,
    "address": "0x..."
  }
}
```

**Features:**
- ✅ Multi-chain support: **Base, Ethereum, and Polygon**
- 💰 USD prices from CoinGecko Pro API
- 🔄 Fallback to DexScreener for tokens not found in CoinGecko
- 📊 Returns total portfolio value in USD

---

### 3. Get NFT Holdings
**GET** `/api/cdp/wallet/nfts/:name`

Fetches all NFTs across Base, Ethereum, and Polygon using Alchemy API.

**URL Parameters:**
- `name` - User's entity ID (account name)

**Response:**
```json
{
  "success": true,
  "data": {
    "nfts": [
      {
        "chain": "base",
        "contractAddress": "0x...",
        "tokenId": "1234",
        "name": "Cool NFT #1234",
        "description": "A cool NFT",
        "image": "https://...",
        "collection": "Cool Collection",
        "tokenType": "ERC721"
      }
    ],
    "address": "0x..."
  }
}
```

---

### 4. Get Transaction History
**GET** `/api/cdp/wallet/history/:name`

Fetches transaction history across all networks using Alchemy's `alchemy_getAssetTransfers`.

**URL Parameters:**
- `name` - User's entity ID (account name)

**Response:**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "chain": "base",
        "hash": "0x...",
        "from": "0x...",
        "to": "0x...",
        "value": "1.5",
        "asset": "ETH",
        "category": "external",
        "timestamp": 1700000000000,
        "blockNum": "0x123456",
        "explorerUrl": "https://basescan.org/tx/0x..."
      }
    ],
    "address": "0x..."
  }
}
```

**Features:**
- Sorted by timestamp (most recent first)
- Includes external transfers, ERC20, ERC721, ERC1155
- Provides explorer URLs for each transaction

---

### 5. Send Tokens
**POST** `/api/cdp/wallet/send`

Sends tokens from the server wallet to another address.

**Request Body:**
```json
{
  "name": "user-entity-id",
  "network": "base",
  "to": "0x...",
  "token": "0x..." or "eth" or "usdc",
  "amount": "1000000000000000000"
}
```

**Notes:**
- `amount` should be in base units (wei for ETH, smallest unit for tokens)
- For ETH: use `"eth"` as token
- For tokens: use contract address as `0x...`

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionHash": "0x...",
    "from": "0x...",
    "to": "0x...",
    "amount": "1000000000000000000",
    "token": "eth",
    "network": "base"
  }
}
```

---

### 6. Send NFT
**POST** `/api/cdp/wallet/send-nft`

Sends an NFT from the server wallet to another address.

**Request Body:**
```json
{
  "name": "user-entity-id",
  "network": "base",
  "to": "0x...",
  "contractAddress": "0x...",
  "tokenId": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transactionHash": "0x...",
    "from": "0x...",
    "to": "0x...",
    "contractAddress": "0x...",
    "tokenId": "1234",
    "network": "base"
  }
}
```

---

## Environment Variables Required

Make sure these are set in your `.env` file:

```env
# CDP Credentials
COINBASE_API_KEY_NAME=your_api_key_name
COINBASE_PRIVATE_KEY=your_private_key
COINBASE_WALLET_SECRET=your_wallet_secret

# Alchemy API (for NFTs and transaction history)
ALCHEMY_API_KEY=your_alchemy_key

# CoinGecko Pro API (for token prices)
COINGECKO_API_KEY=your_coingecko_pro_key
```

---

## Frontend Usage Example

```typescript
// Get user's entity ID from your auth system
const userId = getUserId();

// 1. Fetch token balances
const tokensResponse = await fetch(
  `http://localhost:3050/api/cdp/wallet/tokens/${userId}`
);
const { data: tokensData } = await tokensResponse.json();
console.log('Total portfolio value:', tokensData.totalUsdValue);
console.log('Tokens:', tokensData.tokens);

// 2. Fetch NFTs
const nftsResponse = await fetch(
  `http://localhost:3050/api/cdp/wallet/nfts/${userId}`
);
const { data: nftsData } = await nftsResponse.json();
console.log('NFTs:', nftsData.nfts);

// 3. Fetch transaction history
const historyResponse = await fetch(
  `http://localhost:3050/api/cdp/wallet/history/${userId}`
);
const { data: historyData } = await historyResponse.json();
console.log('Transactions:', historyData.transactions);

// 4. Send tokens
const sendResponse = await fetch('http://localhost:3050/api/cdp/wallet/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: userId,
    network: 'base',
    to: '0xRecipientAddress',
    token: 'eth',
    amount: '1000000000000000000', // 1 ETH in wei
  }),
});
const { data: sendData } = await sendResponse.json();
console.log('Transaction hash:', sendData.transactionHash);

// 5. Send NFT
const sendNftResponse = await fetch(
  'http://localhost:3050/api/cdp/wallet/send-nft',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: userId,
      network: 'base',
      to: '0xRecipientAddress',
      contractAddress: '0xNFTContractAddress',
      tokenId: '1234',
    }),
  }
);
const { data: sendNftData } = await sendNftResponse.json();
console.log('NFT transfer hash:', sendNftData.transactionHash);
```

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": "Additional error details (optional)"
  }
}
```

Common error codes:
- `INVALID_REQUEST` - Missing or invalid parameters
- `SERVICE_UNAVAILABLE` - CDP client or required services not initialized
- `FETCH_TOKENS_FAILED` - Failed to fetch token balances
- `FETCH_NFTS_FAILED` - Failed to fetch NFTs
- `FETCH_HISTORY_FAILED` - Failed to fetch transaction history
- `SEND_FAILED` - Failed to send tokens
- `SEND_NFT_FAILED` - Failed to send NFT

