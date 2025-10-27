import type { Plugin } from "@elizaos/core";
import { CoinGeckoService } from "./services/coingecko.service";
import { getTokenMetadataAction } from "./actions/getTokenMetadata.action";
import { getTrendingTokensAction } from "./actions/getTrendingTokens.action";
import { getNFTCollectionStatsAction } from "./actions/getNFTCollectionStats.action";
import { getTrendingSearchAction } from "./actions/getTrendingSearch.action";

export const coingeckoPlugin: Plugin = {
  name: "plugin-coingecko",
  description: "CoinGecko plugin exposing token metadata lookup, trending tokens, NFT collection stats, and trending searches",
  actions: [getTokenMetadataAction, getTrendingTokensAction, getNFTCollectionStatsAction, getTrendingSearchAction],
  services: [CoinGeckoService],
  evaluators: [],
  providers: [],
};

export default coingeckoPlugin;

export { CoinGeckoService, getTokenMetadataAction, getTrendingTokensAction, getNFTCollectionStatsAction, getTrendingSearchAction };


