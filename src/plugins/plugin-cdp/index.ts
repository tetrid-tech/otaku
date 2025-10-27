import type { Plugin } from "@elizaos/core";

// Services
import { CdpService } from "./services/cdp.service";

// Actions
// import { cdpWalletBalance } from "./actions/cdp-wallet-balance";
// import { cdpCreateWallet } from "./actions/cdp-wallet-create";
import { cdpWalletInfo } from "./actions/cdp-wallet-info";
import { cdpWalletSwap } from "./actions/cdp-wallet-swap";
import { cdpWalletTokenTransfer } from "./actions/cdp-wallet-token-transfer";
import { cdpWalletNftTransfer } from "./actions/cdp-wallet-nft-transfer";
// import { cdpWalletUnwrap } from "./actions/cdp-wallet-unwrap";

// Providers
import { walletStateProvider } from "./providers/walletState";

// Types
export type { CdpNetwork } from "./types";

export const cdpPlugin: Plugin = {
  name: "cdp",
  description:
    "Coinbase Developer Platform plugin providing authenticated EVM account creation, token transfers, NFT transfers, and swaps via CDP SDK",
  evaluators: [],
  providers: [walletStateProvider],
  actions: [cdpWalletInfo, cdpWalletTokenTransfer, cdpWalletNftTransfer, cdpWalletSwap],
  services: [CdpService],
};

export default cdpPlugin;


