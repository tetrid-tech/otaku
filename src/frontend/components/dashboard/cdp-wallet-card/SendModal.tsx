import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { elizaClient } from '../../../lib/elizaClient';

interface Token {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
  usdPrice: number;
  contractAddress: string | null;
  chain: string;
  decimals: number;
}

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  userId: string;
  onSuccess: () => void;
}

export function SendModal({ isOpen, onClose, tokens, userId, onSuccess }: SendModalProps) {
  const [selectedToken, setSelectedToken] = useState<Token | null>(tokens[0] || null);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Get explorer URL
  const getExplorerUrl = (chain: string, hash: string) => {
    const explorers: Record<string, string> = {
      base: 'https://basescan.org',
      ethereum: 'https://etherscan.io',
      polygon: 'https://polygonscan.com',
    };
    return `${explorers[chain] || explorers.base}/tx/${hash}`;
  };

  // Handle send
  const handleSend = async () => {
    if (!selectedToken || !recipientAddress || !amount) {
      setError('Please fill in all fields');
      return;
    }

    // Validate address format
    if (!recipientAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Invalid recipient address');
      return;
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Invalid amount');
      return;
    }

    // Check if amount exceeds balance
    const balanceNum = parseFloat(selectedToken.balance);
    if (amountNum > balanceNum) {
      setError(`Insufficient balance. You have ${selectedToken.balanceFormatted} ${selectedToken.symbol}`);
      return;
    }

    setIsSending(true);
    setError(null);
    setTxHash(null);

    try {
      // Convert amount to base units (wei/smallest unit)
      const amountInBaseUnits = (amountNum * Math.pow(10, selectedToken.decimals)).toString();

      // Determine token parameter
      let tokenParam: string;
      if (!selectedToken.contractAddress) {
        // Native token (ETH, MATIC, etc)
        tokenParam = selectedToken.symbol.toLowerCase();
      } else {
        tokenParam = selectedToken.contractAddress;
      }

      const data = await elizaClient.cdp.sendToken({
        name: userId,
        network: selectedToken.chain,
        to: recipientAddress,
        token: tokenParam,
        amount: amountInBaseUnits,
      });

      setTxHash(data.transactionHash);
      setIsSending(false);
      // Don't auto-close, let user close manually after seeing success
    } catch (err) {
      console.error('Error sending transaction:', err);
      setError(err instanceof Error ? err.message : 'Failed to send transaction');
      setIsSending(false);
    }
  };

  // Handle close
  const handleClose = () => {
    if (!isSending) {
      setSelectedToken(tokens[0] || null);
      setRecipientAddress('');
      setAmount('');
      setError(null);
      setTxHash(null);
      onClose();
    }
  };

  const handleMaxClick = () => {
    if (selectedToken) {
      setAmount(selectedToken.balance);
    }
  };

  if (!isOpen) return null;

  // Success screen
  if (txHash && selectedToken) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={handleClose}>
        <div className="bg-background rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4 max-h-[calc(90vh-0.75rem)] overflow-y-auto">
            <h3 className="text-lg font-semibold">Transaction Sent!</h3>
            
            <div className="space-y-2">
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded">
                <p className="text-sm text-green-500">✅ Successfully sent {amount} {selectedToken.symbol}</p>
              </div>
              
              <div className="text-sm space-y-1">
                <p className="text-muted-foreground">Transaction Hash:</p>
                <a 
                  href={getExplorerUrl(selectedToken.chain, txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline break-all"
                >
                  {txHash.slice(0, 10)}...{txHash.slice(-8)}
                </a>
              </div>
            </div>

            <Button 
              onClick={() => {
                onSuccess();
                handleClose();
              }} 
              className="w-full"
            >
              Close
            </Button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Loading screen
  if (isSending) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-background rounded-lg max-w-md w-full overflow-hidden p-1.5">
          <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4">
            <h3 className="text-lg font-semibold">Sending Transaction...</h3>
            
            <div className="space-y-3">
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              </div>
              
              <p className="text-sm text-muted-foreground text-center">
                Please wait while your transaction is being processed...
              </p>
              
              {selectedToken && (
                <div className="p-3 bg-muted rounded text-sm">
                  <p className="font-medium">Sending:</p>
                  <p className="text-muted-foreground">{amount} {selectedToken.symbol} on {selectedToken.chain}</p>
                  <p className="text-xs text-muted-foreground mt-1">To: {recipientAddress.slice(0, 10)}...{recipientAddress.slice(-8)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={handleClose}>
      <div className="bg-background rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4 max-h-[calc(90vh-0.75rem)] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Send Tokens</h3>
            <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>

          {/* Token Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Token</label>
            <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
              {tokens.map((token, index) => (
                <button
                  key={`${token.chain}-${token.contractAddress || token.symbol}-${index}`}
                  onClick={() => setSelectedToken(token)}
                  className={`w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors border-b border-border last:border-b-0 ${
                    selectedToken?.contractAddress === token.contractAddress && selectedToken?.chain === token.chain
                      ? 'bg-muted/50'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{token.symbol}</span>
                    <span className="text-xs text-muted-foreground capitalize">({token.chain})</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{token.balanceFormatted}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recipient Address */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Recipient Address</label>
            <Input
              type="text"
              placeholder="0x..."
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              disabled={isSending}
            />
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Amount</label>
            <div className="relative">
              <Input
                type="number"
                step="any"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isSending}
              />
              {selectedToken && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 text-xs"
                  onClick={handleMaxClick}
                  disabled={isSending}
                >
                  Max
                </Button>
              )}
            </div>
            {selectedToken && amount && (
              <div className="text-xs text-muted-foreground">
                ≈ ${(parseFloat(amount) * selectedToken.usdPrice).toFixed(2)}
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isSending}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={isSending || !selectedToken || !recipientAddress || !amount}
              className="flex-1"
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
