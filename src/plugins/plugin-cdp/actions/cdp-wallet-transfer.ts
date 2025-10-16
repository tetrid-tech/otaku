import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
  ModelType,
  composePromptFromState,
  parseKeyValueXml,
} from "@elizaos/core";
import { parseUnits, createPublicClient, http, formatUnits } from "viem";
import { base, mainnet, polygon } from "viem/chains";
import { getEntityWallet } from "../../../utils/entity";
import { CdpService } from "../services/cdp.service";
import type { CoinGeckoService } from "../../plugin-coingecko/src/services/coingecko.service";
import type { CdpNetwork } from "../types";

const transferTemplate = `# Token Transfer Request

## Conversation Context
{{recentMessages}}

## Supported Networks
- base (Base Mainnet)
- base-sepolia (Base Sepolia Testnet)
- ethereum (Ethereum Mainnet)
- ethereum-sepolia (Ethereum Sepolia Testnet)
- arbitrum (Arbitrum One)
- optimism (Optimism Mainnet)
- polygon (Polygon Mainnet)

## Instructions
Determine and extract the user's transfer details from the conversation context. All fields are required.

**Important Notes:**
- Amount should be in human-readable format (e.g., "10.5" for 10.5 tokens)
- Recipient address must start with 0x and be 42 characters
- For ENS names, resolve to 0x address first
- Token can be a symbol (ETH, USDC, BNXR, DAI) or contract address
- Default to base network if not specified

Respond with the transfer parameters in this exact format:
<response>
  <network>base</network>
  <to>0x1234567890123456789012345678901234567890</to>
  <token>bnxr</token>
  <amount>10.5</amount>
</response>`;

type ChainNetwork = 'base' | 'ethereum' | 'polygon' | 'base-sepolia' | 'ethereum-sepolia' | 'arbitrum' | 'optimism';

interface ChainConfig {
  name: string;
  rpcUrl: string;
  nativeToken: {
    symbol: string;
    name: string;
  };
  coingeckoPlatform: string;
  chainId: number;
}

const CHAIN_CONFIGS: Record<ChainNetwork, ChainConfig> = {
  base: {
    name: 'Base',
    rpcUrl: 'BASE_RPC_URL',
    nativeToken: { symbol: 'ETH', name: 'Ethereum' },
    coingeckoPlatform: 'base',
    chainId: 8453,
  },
  'base-sepolia': {
    name: 'Base Sepolia',
    rpcUrl: 'BASE_SEPOLIA_RPC_URL',
    nativeToken: { symbol: 'ETH', name: 'Ethereum' },
    coingeckoPlatform: 'base',
    chainId: 84532,
  },
  ethereum: {
    name: 'Ethereum',
    rpcUrl: 'ETHEREUM_RPC_URL',
    nativeToken: { symbol: 'ETH', name: 'Ethereum' },
    coingeckoPlatform: 'ethereum',
    chainId: 1,
  },
  'ethereum-sepolia': {
    name: 'Ethereum Sepolia',
    rpcUrl: 'ETHEREUM_SEPOLIA_RPC_URL',
    nativeToken: { symbol: 'ETH', name: 'Ethereum' },
    coingeckoPlatform: 'ethereum',
    chainId: 11155111,
  },
  arbitrum: {
    name: 'Arbitrum',
    rpcUrl: 'ARBITRUM_RPC_URL',
    nativeToken: { symbol: 'ETH', name: 'Ethereum' },
    coingeckoPlatform: 'arbitrum-one',
    chainId: 42161,
  },
  optimism: {
    name: 'Optimism',
    rpcUrl: 'OPTIMISM_RPC_URL',
    nativeToken: { symbol: 'ETH', name: 'Ethereum' },
    coingeckoPlatform: 'optimistic-ethereum',
    chainId: 10,
  },
  polygon: {
    name: 'Polygon',
    rpcUrl: 'POLYGON_RPC_URL',
    nativeToken: { symbol: 'MATIC', name: 'Polygon' },
    coingeckoPlatform: 'polygon-pos',
    chainId: 137,
  },
};

const VIEM_CHAINS: Record<string, any> = {
  base,
  'base-sepolia': base, // Use base chain for testnet
  ethereum: mainnet,
  'ethereum-sepolia': mainnet, // Use mainnet chain for testnet
  arbitrum: base, // Fallback
  optimism: base, // Fallback
  polygon,
};

// ERC20 ABI for balance check and metadata
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

interface TransferParams {
  network: ChainNetwork;
  to: `0x${string}`;
  token: string;
  amount: string;
}

const parseTransferParams = (text: string): TransferParams | null => {
  const parsed = parseKeyValueXml(text);
  
  if (!parsed?.network || !parsed?.to || !parsed?.token || !parsed?.amount) {
    return null;
  }

  // Validate recipient address
  const to = parsed.to.trim();
  if (!to.startsWith("0x") || to.length !== 42) {
    logger.warn(`Invalid recipient address: ${to}`);
    return null;
  }

  return {
    network: parsed.network as ChainNetwork,
    to: to as `0x${string}`,
    token: parsed.token.toLowerCase(),
    amount: parsed.amount,
  };
};

// Resolve token using CoinGecko service
async function resolveToken(
  runtime: IAgentRuntime,
  tokenInput: string,
  chain: ChainNetwork,
  walletAddress: string,
): Promise<{
  address: `0x${string}` | 'eth' | 'usdc'; // CDP supports 'eth' and 'usdc' as special strings
  symbol: string;
  decimals: number;
  name: string;
  isNative: boolean;
} | null> {
  // Check if it's already a contract address
  if (tokenInput.startsWith('0x') && tokenInput.length === 42) {
    try {
      const chainConfig = CHAIN_CONFIGS[chain];
      const rpcUrl = process.env[chainConfig.rpcUrl];
      if (!rpcUrl) {
        logger.warn(`RPC URL not configured for ${chain}`);
        return null;
      }

      const viemChain = VIEM_CHAINS[chain];
      const publicClient = createPublicClient({
        chain: viemChain,
        transport: http(rpcUrl),
      });

      const [symbol, decimals, name] = await Promise.all([
        publicClient.readContract({
          address: tokenInput as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
        publicClient.readContract({
          address: tokenInput as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }),
        publicClient.readContract({
          address: tokenInput as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'name',
        }),
      ]);

      logger.info(`✅ Resolved contract address: ${name} (${symbol})`);

      return {
        address: tokenInput as `0x${string}`,
        symbol: symbol || 'UNKNOWN',
        decimals: decimals || 18,
        name: name || 'Unknown Token',
        isNative: false,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to fetch on-chain token info for ${tokenInput}: ${errorMsg}`);
      return null;
    }
  }

  // Check if it's a native token
  const chainConfig = CHAIN_CONFIGS[chain];
  const isNative = tokenInput === 'eth' || 
                   (chain === 'polygon' && tokenInput === 'matic') ||
                   tokenInput === chainConfig.nativeToken.symbol.toLowerCase();
  
  if (isNative) {
    logger.info(`✅ Resolved as native token: ${chainConfig.nativeToken.symbol}`);
    return {
      address: 'eth', // CDP uses 'eth' for native tokens
      symbol: chainConfig.nativeToken.symbol,
      decimals: 18,
      name: chainConfig.nativeToken.name,
      isNative: true,
    };
  }

  // Check for USDC (CDP has special support)
  if (tokenInput === 'usdc') {
    logger.info(`✅ Resolved as USDC (CDP native support)`);
    return {
      address: 'usdc',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      isNative: false,
    };
  }

  // Try to resolve using CoinGecko service
  try {
    const coingeckoService = runtime.getService?.("COINGECKO_SERVICE") as CoinGeckoService | undefined;
    
    if (coingeckoService) {
      logger.info(`Resolving token "${tokenInput}" using CoinGecko service...`);
      const results = await coingeckoService.getTokenMetadata(tokenInput);
      
      if (results && results.length > 0 && results[0].success && results[0].data) {
        const tokenData = results[0].data;
        const platform = chainConfig.coingeckoPlatform;
        
        // Check if token exists on this chain
        const contractAddress = tokenData.platforms?.[platform] || 
                               tokenData.detail_platforms?.[platform]?.contract_address;
        
        if (contractAddress && contractAddress.startsWith('0x')) {
          const decimals = tokenData.detail_platforms?.[platform]?.decimal_place || 18;
          
          logger.info(`✅ Found token via CoinGecko: ${tokenData.symbol} (${contractAddress}) on ${chain}`);
          
          return {
            address: contractAddress as `0x${string}`,
            symbol: (tokenData.symbol || tokenInput).toUpperCase(),
            decimals,
            name: tokenData.name || tokenInput,
            isNative: false,
          };
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`CoinGecko resolution failed for ${tokenInput}: ${errorMsg}`);
  }

  // Last resort: Check user's wallet for matching tokens
  logger.info(`Checking user's wallet for token "${tokenInput}"...`);
  try {
    const chainConfig = CHAIN_CONFIGS[chain];
    const rpcUrl = process.env[chainConfig.rpcUrl];
    if (!rpcUrl) {
      logger.warn(`RPC URL not configured for ${chain}`);
      return null;
    }

    // Use Alchemy to get user's tokens
    const alchemyApiKey = process.env.ALCHEMY_API_KEY;
    if (alchemyApiKey && rpcUrl.includes('{{ALCHEMY_API_KEY}}')) {
      const alchemyRpcUrl = rpcUrl.replace('{{ALCHEMY_API_KEY}}', alchemyApiKey);
      
      const response = await fetch(alchemyRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'alchemy_getTokenBalances',
          params: [walletAddress],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const tokens = data.result?.tokenBalances || [];

        const viemChain = VIEM_CHAINS[chain];
        const publicClient = createPublicClient({
          chain: viemChain,
          transport: http(alchemyRpcUrl),
        });

        // Try to find a matching token by symbol
        for (const tokenBalance of tokens) {
          const contractAddress = tokenBalance.contractAddress;
          if (!contractAddress) continue;

          try {
            const [symbol, decimals, name] = await Promise.all([
              publicClient.readContract({
                address: contractAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'symbol',
              }),
              publicClient.readContract({
                address: contractAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'decimals',
              }),
              publicClient.readContract({
                address: contractAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'name',
              }),
            ]);

            if (symbol.toLowerCase() === tokenInput.toLowerCase()) {
              logger.info(`✅ Found token in user's wallet: ${symbol} (${contractAddress})`);
              return {
                address: contractAddress as `0x${string}`,
                symbol: symbol || 'UNKNOWN',
                decimals: decimals || 18,
                name: name || 'Unknown Token',
                isNative: false,
              };
            }
          } catch {
            // Skip this token and try next
            continue;
          }
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to check wallet tokens: ${errorMsg}`);
  }

  return null;
}

export const cdpWalletTransfer: Action = {
  name: "WALLET_TRANSFER",
  similes: [
    "SEND",
    "TRANSFER",
    "PAY",
    "SEND_TOKENS",
    "TRANSFER_TOKENS",
    "SEND_CRYPTO",
  ],
  description: "Use this action when the user wants to transfer or send tokens/crypto to another address. This supports native tokens (ETH, MATIC) and any ERC20 tokens across Base, Ethereum, Polygon, and other supported networks.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    try {
      const cdpService = _runtime.getService(
        CdpService.serviceType,
      ) as CdpService;

      if (!cdpService) {
        logger.warn("CDP service not available for transfer");
        return false;
      }

      // Check if wallet exists
      const walletResult = await getEntityWallet(
        _runtime,
        message,
        "WALLET_TRANSFER",
      );
      return walletResult.success;
    } catch (error) {
      logger.error(
        "Error validating transfer action:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const cdpService = runtime.getService(CdpService.serviceType) as CdpService;
      
      if (!cdpService) {
        throw new Error("CDP Service not initialized");
      }

      // Ensure the user has a wallet
      const walletResult = await getEntityWallet(
        runtime,
        message,
        "WALLET_TRANSFER",
        callback,
      );
      if (walletResult.success === false) {
        return walletResult.result;
      }

      const walletAddress = walletResult.walletAddress;

      // Compose state and get transfer parameters from LLM
      const composedState = await runtime.composeState(message, ["RECENT_MESSAGES"], true);
      const context = composePromptFromState({
        state: composedState,
        template: transferTemplate,
      });

      const xmlResponse = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: context,
      });

      const transferParams = parseTransferParams(xmlResponse);
      
      if (!transferParams) {
        throw new Error("Failed to parse transfer parameters from request. Please specify the amount, token, recipient address, and network.");
      }

      // Resolve token address, symbol, and decimals
      const tokenInfo = await resolveToken(
        runtime,
        transferParams.token,
        transferParams.network,
        walletAddress,
      );

      if (!tokenInfo) {
        throw new Error(
          `❌ Could not find token "${transferParams.token.toUpperCase()}" on ${transferParams.network}.\n\n` +
          `Please provide:\n` +
          `• A valid token symbol (ETH, USDC, DAI, etc.)\n` +
          `• Or a contract address (0x...)\n` +
          `• Make sure the token exists on ${transferParams.network} network`
        );
      }

      const chainConfig = CHAIN_CONFIGS[transferParams.network];

      // Parse amount
      const amount = parseUnits(transferParams.amount, tokenInfo.decimals);

      logger.info(
        `Executing transfer: network=${transferParams.network}, ` +
        `to=${transferParams.to}, token=${tokenInfo.symbol}, ` +
        `amount=${transferParams.amount} (${amount.toString()} raw)`
      );

      // Determine token type for CDP API
      let token: `0x${string}` | "usdc" | "eth";
      
      if (tokenInfo.address === 'eth' || tokenInfo.address === 'usdc') {
        token = tokenInfo.address;
      } else {
        token = tokenInfo.address as `0x${string}`;
      }

      // Execute transfer via CDP service
      const result = await cdpService.transfer({
        accountName: message.entityId,
        network: transferParams.network as CdpNetwork,
        to: transferParams.to,
        token,
        amount,
      });

      const txHash = result.transactionHash;

      // Get explorer URL
      const getExplorerUrl = (hash: string, network: string) => {
        const explorers: Record<string, string> = {
          base: 'https://basescan.org',
          'base-sepolia': 'https://sepolia.basescan.org',
          ethereum: 'https://etherscan.io',
          'ethereum-sepolia': 'https://sepolia.etherscan.io',
          arbitrum: 'https://arbiscan.io',
          optimism: 'https://optimistic.etherscan.io',
          polygon: 'https://polygonscan.com',
        };
        return `${explorers[network] || explorers.base}/tx/${hash}`;
      };

      const successText = 
        `✅ **Transfer Sent Successfully!**\n\n` +
        `**Amount:** ${transferParams.amount} ${tokenInfo.symbol}\n` +
        `**To:** \`${transferParams.to.slice(0, 6)}...${transferParams.to.slice(-4)}\`\n` +
        `**Network:** ${chainConfig.name}\n` +
        `**Transaction:** ${getExplorerUrl(txHash, transferParams.network)}\n\n` +
        `Your transfer is being processed on the blockchain.`;

      const data = {
        actionName: 'WALLET_TRANSFER',
        success: true,
        transactionHash: txHash,
        network: transferParams.network,
        to: transferParams.to,
        token: tokenInfo.symbol,
        tokenAddress: tokenInfo.address,
        amount: transferParams.amount,
        decimals: tokenInfo.decimals,
        explorerUrl: getExplorerUrl(txHash, transferParams.network),
      };

      callback?.({ text: successText, content: data });

      return {
        text: successText,
        success: true,
        data,
        values: data,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`WALLET_TRANSFER error: ${errorMsg}`);
      
      let errorMessage = "❌ **Transfer failed**\n\n";
      if (error instanceof Error) {
        if (error.message.startsWith('❌')) {
          // Already formatted
          errorMessage = error.message;
        } else if (error.message.includes("insufficient")) {
          errorMessage += "Insufficient balance for this transfer.";
        } else if (error.message.includes("invalid address") || error.message.includes("Invalid recipient")) {
          errorMessage += "Invalid recipient address provided.";
        } else if (error.message.includes("not authenticated") || error.message.includes("no wallet")) {
          errorMessage += "Wallet not found. Please create a wallet first.";
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += "An unknown error occurred.";
      }
      
      callback?.({
        text: errorMessage,
        content: { 
          error: "wallet_transfer_failed", 
          details: errorMsg
        },
      });
      
      return {
        text: errorMessage,
        success: false,
        error: error as Error,
      };
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "send 3 bnxr to 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb5" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll help you send 3 BNXR tokens to that address.",
          action: "WALLET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "transfer 0.5 ETH to 0xabcd...1234" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Sending 0.5 ETH to the specified address...",
          action: "WALLET_TRANSFER",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "pay 100 USDC to my friend 0x9999...8888 on ethereum" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Processing payment of 100 USDC on Ethereum mainnet...",
          action: "WALLET_TRANSFER",
        },
      },
    ],
  ],
};

export default cdpWalletTransfer;
