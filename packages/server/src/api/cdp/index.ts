import express from 'express';
import { logger } from '@elizaos/core';
import { CdpClient } from '@coinbase/cdp-sdk';
import type { AgentServer } from '../../index';
import { sendError, sendSuccess } from '../shared/response-utils';

// Singleton CDP client instance
let cdpClient: CdpClient | null = null;

/**
 * Initialize CDP client with environment variables
 */
function getCdpClient(): CdpClient | null {
  if (cdpClient) {
    return cdpClient;
  }

  const apiKeyId = process.env.COINBASE_API_KEY_NAME || process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.COINBASE_PRIVATE_KEY || process.env.CDP_API_KEY_SECRET;
  const walletSecret = process.env.COINBASE_WALLET_SECRET;

  if (!apiKeyId || !apiKeySecret || !walletSecret) {
    logger.warn('[CDP API] Missing CDP credentials in environment variables');
    return null;
  }

  try {
    cdpClient = new CdpClient({
      apiKeyId,
      apiKeySecret,
      walletSecret,
    });
    logger.info('[CDP API] CDP client initialized successfully');
    return cdpClient;
  } catch (error) {
    logger.error('[CDP API] Failed to initialize CDP client:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Fetch token info (price and icon) from CoinGecko Pro API
 */
async function getTokenInfo(contractAddress: string, platform: string): Promise<{
  price: number;
  icon?: string;
  name?: string;
  symbol?: string;
} | null> {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) {
    logger.warn('[CDP API] CoinGecko API key not configured');
    return null;
  }

  try {
    // Use the full coin endpoint to get price, icon, and metadata
    const url = `https://pro-api.coingecko.com/api/v3/coins/${platform}/contract/${contractAddress}`;
    const response = await fetch(url, {
      headers: {
        'x-cg-pro-api-key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        price: data.market_data?.current_price?.usd || 0,
        icon: data.image?.small, // Small icon URL
        name: data.name,
        symbol: data.symbol?.toUpperCase(),
      };
    }
  } catch (err) {
    logger.warn(`[CDP API] Failed to fetch token info for ${contractAddress}:`, err instanceof Error ? err.message : String(err));
  }

  return null;
}

/**
 * Fetch token info from DexScreener
 */
async function getTokenInfoFromDexScreener(address: string, chainId: string): Promise<{
  price?: number;
  liquidity?: number;
  volume24h?: number;
  priceChange24h?: number;
} | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const pairs = data.pairs || [];
    
    // Find pair for the specific chain
    const pair = pairs.find((p: any) => p.chainId === chainId);
    
    if (!pair) {
      return null;
    }

    return {
      price: parseFloat(pair.priceUsd) || undefined,
      liquidity: parseFloat(pair.liquidity?.usd) || undefined,
      volume24h: parseFloat(pair.volume?.h24) || undefined,
      priceChange24h: parseFloat(pair.priceChange?.h24) || undefined,
    };
  } catch (err) {
    logger.warn(`[CDP API] DexScreener error for ${address}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Check if a contract address is an NFT contract using Alchemy NFT API
 */
async function isNftContract(contractAddress: string, network: string): Promise<boolean> {
  try {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      return false;
    }

    const nftApiMap: Record<string, string> = {
      base: `https://base-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForContract`,
      ethereum: `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForContract`,
      polygon: `https://polygon-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForContract`,
    };

    const baseUrl = nftApiMap[network];
    if (!baseUrl) {
      return false;
    }

    const url = `${baseUrl}?contractAddress=${contractAddress}&withMetadata=false&limit=1`;
    const response = await fetch(url, { method: 'GET' });

    if (response.ok) {
      const data = await response.json();
      // If the contract returns NFT data, it's an NFT contract
      return data.nfts && data.nfts.length > 0;
    }

    return false;
  } catch (err) {
    logger.debug(`[CDP API] Could not verify contract type for ${contractAddress}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

export function cdpRouter(_serverInstance: AgentServer): express.Router {
  const router = express.Router();

  /**
   * POST /api/cdp/wallet
   * Get or create server wallet for a user
   */
  router.post('/wallet', async (req, res) => {
    try {
      const { name } = req.body;

      if (!name || typeof name !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Name is required and must be a string');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized. Check environment variables.');
      }

      logger.info(`[CDP API] Getting/creating wallet for user: ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      const address = account.address;

      logger.info(`[CDP API] Wallet ready: ${address} (user: ${name})`);

      sendSuccess(res, {
        address,
        accountName: name,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error with wallet:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'WALLET_FAILED',
        'Failed to get/create wallet',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/tokens/:name
   * Get token balances across all networks
   */
  router.get('/wallet/tokens/:name', async (req, res) => {
    try {
      const { name } = req.params;

      if (!name || typeof name !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Name is required');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Fetching token balances for user: ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      
      // Supported networks - CDP SDK supports base, ethereum, and polygon for listTokenBalances
      const networks = ['base', 'ethereum', 'polygon'] as const;
      const platformMap: Record<string, string> = {
        base: 'base',
        ethereum: 'ethereum',
        polygon: 'polygon-pos',
      };

      const allTokens: any[] = [];
      let totalUsdValue = 0;

      for (const network of networks) {
        try {
          const balancesResponse = await account.listTokenBalances({ network });
          const balances = balancesResponse?.balances || [];

          if (balances.length === 0) continue;

          // Format tokens
          for (const balance of balances) {
            const symbol = balance?.token?.symbol || 'UNKNOWN';
            const contractAddress = balance?.token?.contractAddress;
            const amountRaw = balance?.amount?.amount?.toString() || '0';
            const decimals = balance?.amount?.decimals || 18;
            
            // Skip if it's an NFT contract
            if (contractAddress && await isNftContract(contractAddress, network)) {
              logger.debug(`[CDP API] Skipping NFT contract: ${symbol} at ${contractAddress}`);
              continue;
            }
            
            // Convert to human-readable
            const amountNum = parseFloat(amountRaw) / Math.pow(10, decimals);
            
            // Get token info (price and icon) from CoinGecko
            let usdPrice = 0;
            let icon: string | undefined = undefined;
            let tokenName = balance?.token?.name || symbol;
            
            if (contractAddress) {
              const tokenInfo = await getTokenInfo(contractAddress, platformMap[network]);
              if (tokenInfo) {
                usdPrice = tokenInfo.price;
                icon = tokenInfo.icon;
                if (tokenInfo.name) tokenName = tokenInfo.name;
              } else {
                // Fallback to DexScreener if CoinGecko fails
                const dexInfo = await getTokenInfoFromDexScreener(contractAddress, network);
                if (dexInfo?.price) {
                  usdPrice = dexInfo.price;
                }
              }
            }

            const usdValue = amountNum * usdPrice;
            totalUsdValue += usdValue;

            allTokens.push({
              symbol,
              name: tokenName,
              balance: amountNum.toString(),
              balanceFormatted: amountNum.toFixed(6).replace(/\.?0+$/, ''),
              usdValue,
              usdPrice,
              contractAddress: contractAddress || null,
              chain: network,
              decimals,
              icon, // Add icon field
            });
          }
        } catch (err) {
          logger.warn(`[CDP API] Failed to fetch balances for ${network}:`, err instanceof Error ? err.message : String(err));
        }
      }

      logger.info(`[CDP API] Found ${allTokens.length} tokens for user ${name}, total value: $${totalUsdValue.toFixed(2)}`);

      sendSuccess(res, {
        tokens: allTokens,
        totalUsdValue,
        address: account.address,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching tokens:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_TOKENS_FAILED',
        'Failed to fetch token balances',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/nfts/:name
   * Get NFT holdings across networks using Alchemy API
   */
  router.get('/wallet/nfts/:name', async (req, res) => {
    try {
      const { name } = req.params;

      if (!name || typeof name !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Name is required');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Alchemy API key not configured');
      }

      logger.info(`[CDP API] Fetching NFTs for user: ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      const address = account.address;

      // Fetch NFTs from Base and Ethereum using Alchemy REST API
      const networks = [
        { name: 'base', url: `https://base-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100` },
        { name: 'ethereum', url: `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100` },
        { name: 'polygon', url: `https://polygon-mainnet.g.alchemy.com/nft/v3/${alchemyKey}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=100` },
      ];

      const allNfts: any[] = [];

      for (const network of networks) {
        try {
          const response = await fetch(network.url);
          
          if (!response.ok) {
            logger.warn(`[CDP API] Failed to fetch NFTs for ${network.name}: ${response.status}`);
            continue;
          }

          const data = await response.json();
          const nfts = data.ownedNfts || [];

          for (const nft of nfts) {
            const metadata = nft.raw?.metadata || {};
            const tokenId = nft.tokenId;
            const contractAddress = nft.contract?.address;
            
            // Get image URL and handle IPFS
            let imageUrl = metadata.image || nft.image?.cachedUrl || nft.image?.originalUrl || nft.image?.thumbnailUrl || '';
            if (imageUrl && imageUrl.startsWith('ipfs://')) {
              imageUrl = imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
            }

            allNfts.push({
              chain: network.name,
              contractAddress,
              tokenId,
              name: metadata.name || nft.name || `${nft.contract?.name || 'Unknown'} #${tokenId}`,
              description: metadata.description || nft.description || '',
              image: imageUrl,
              contractName: nft.contract?.name || nft.contract?.symbol || 'Unknown Collection',
              tokenType: nft.contract?.tokenType || 'ERC721',
              balance: nft.balance, // For ERC1155
              attributes: metadata.attributes || [], // NFT attributes/traits
            });
          }
        } catch (err) {
          logger.warn(`[CDP API] Error fetching NFTs for ${network.name}:`, err instanceof Error ? err.message : String(err));
        }
      }

      logger.info(`[CDP API] Found ${allNfts.length} NFTs for user ${name}`);

      sendSuccess(res, {
        nfts: allNfts,
        address,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching NFTs:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_NFTS_FAILED',
        'Failed to fetch NFTs',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * GET /api/cdp/wallet/history/:name
   * Get transaction history across networks using Alchemy API
   */
  router.get('/wallet/history/:name', async (req, res) => {
    try {
      const { name } = req.params;

      if (!name || typeof name !== 'string') {
        return sendError(res, 400, 'INVALID_REQUEST', 'Name is required');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      const alchemyKey = process.env.ALCHEMY_API_KEY;
      if (!alchemyKey) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Alchemy API key not configured');
      }

      logger.info(`[CDP API] Fetching transaction history for user: ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      const address = account.address;

      // Fetch transactions from Base and Ethereum
      const networks = [
        { name: 'base', rpc: `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`, explorer: 'https://basescan.org' },
        { name: 'ethereum', rpc: `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`, explorer: 'https://etherscan.io' },
        { name: 'polygon', rpc: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`, explorer: 'https://polygonscan.com' },
      ];

      const allTransactions: any[] = [];

      for (const network of networks) {
        try {
          // Use Alchemy's alchemy_getAssetTransfers method
          const response = await fetch(network.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'alchemy_getAssetTransfers',
              params: [{
                fromBlock: '0x0',
                toBlock: 'latest',
                fromAddress: address,
                category: ['external', 'erc20', 'erc721', 'erc1155'],
                withMetadata: true,
                maxCount: '0x32', // 50 transactions
              }],
            }),
          });

          if (!response.ok) {
            logger.warn(`[CDP API] Failed to fetch history for ${network.name}: ${response.status}`);
            continue;
          }

          const data = await response.json();
          const transfers = data.result?.transfers || [];

          for (const tx of transfers) {
            const timestamp = tx.metadata?.blockTimestamp ? new Date(tx.metadata.blockTimestamp).getTime() : Date.now();
            
            allTransactions.push({
              chain: network.name,
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              value: tx.value?.toString() || '0',
              asset: tx.asset || 'ETH',
              category: tx.category,
              timestamp,
              blockNum: tx.blockNum,
              explorerUrl: `${network.explorer}/tx/${tx.hash}`,
            });
          }
        } catch (err) {
          logger.warn(`[CDP API] Error fetching history for ${network.name}:`, err instanceof Error ? err.message : String(err));
        }
      }

      // Sort by timestamp descending (most recent first)
      allTransactions.sort((a, b) => b.timestamp - a.timestamp);

      logger.info(`[CDP API] Found ${allTransactions.length} transactions for user ${name}`);

      sendSuccess(res, {
        transactions: allTransactions,
        address,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error fetching history:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'FETCH_HISTORY_FAILED',
        'Failed to fetch transaction history',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/send
   * Send tokens from server wallet
   */
  router.post('/wallet/send', async (req, res) => {
    try {
      const { name, network, to, token, amount } = req.body;

      if (!name || !network || !to || !token || !amount) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: name, network, to, token, amount');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Sending ${amount} ${token} to ${to} on ${network} for user ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      const networkAccount = await account.useNetwork(network);

      // Convert amount to bigint (assuming it's already in base units with decimals)
      const amountBigInt = BigInt(amount);

      const result = await networkAccount.transfer({
        to: to as `0x${string}`,
        amount: amountBigInt,
        token: token as any,
      });

      if (!result.transactionHash) {
        throw new Error('Transfer did not return a transaction hash');
      }

      logger.info(`[CDP API] Transfer successful: ${result.transactionHash}`);

      sendSuccess(res, {
        transactionHash: result.transactionHash,
        from: account.address,
        to,
        amount: amount.toString(),
        token,
        network,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error sending tokens:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SEND_FAILED',
        'Failed to send tokens',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  /**
   * POST /api/cdp/wallet/send-nft
   * Send NFT from server wallet using viem
   */
  router.post('/wallet/send-nft', async (req, res) => {
    try {
      const { name, network, to, contractAddress, tokenId } = req.body;

      if (!name || !network || !to || !contractAddress || !tokenId) {
        return sendError(res, 400, 'INVALID_REQUEST', 'Missing required fields: name, network, to, contractAddress, tokenId');
      }

      const client = getCdpClient();
      if (!client) {
        return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'CDP client not initialized.');
      }

      logger.info(`[CDP API] Sending NFT ${contractAddress}:${tokenId} to ${to} on ${network} for user ${name}`);

      const account = await client.evm.getOrCreateAccount({ name });
      
      // Use viem to send the NFT transaction
      const { createWalletClient, createPublicClient, http } = await import('viem');
      const { toAccount } = await import('viem/accounts');
      const { base, mainnet, polygon } = await import('viem/chains');
      
      const chainMap: Record<string, any> = {
        base,
        ethereum: mainnet,
        polygon,
      };
      
      const chain = chainMap[network] || base;
      const alchemyKey = process.env.ALCHEMY_API_KEY || '';
      const rpcMap: Record<string, string> = {
        base: `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`,
        ethereum: `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
        polygon: `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
      };
      
      const rpcUrl = rpcMap[network] || rpcMap.base;
      
      const walletClient = createWalletClient({
        account: toAccount(account),
        chain,
        transport: http(rpcUrl),
      });
      
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      // ERC721 safeTransferFrom ABI
      const erc721Abi = [
        {
          name: 'safeTransferFrom',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'tokenId', type: 'uint256' }
          ],
          outputs: []
        }
      ] as const;

      const txHash = await walletClient.writeContract({
        address: contractAddress as `0x${string}`,
        abi: erc721Abi,
        functionName: 'safeTransferFrom',
        args: [account.address as `0x${string}`, to as `0x${string}`, BigInt(tokenId)],
        chain,
      });

      // Wait for transaction confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      logger.info(`[CDP API] NFT transfer successful: ${txHash}`);

      sendSuccess(res, {
        transactionHash: txHash,
        from: account.address,
        to,
        contractAddress,
        tokenId,
        network,
      });
    } catch (error) {
      logger.error(
        '[CDP API] Error sending NFT:',
        error instanceof Error ? error.message : String(error)
      );
      sendError(
        res,
        500,
        'SEND_NFT_FAILED',
        'Failed to send NFT',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
