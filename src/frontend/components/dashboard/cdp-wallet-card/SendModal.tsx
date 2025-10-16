import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { elizaClient } from '../../../lib/elizaClient';

interface Token {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number | null;
  usdPrice: number | null;
  contractAddress: string | null;
  chain: string;
  decimals: number;
  icon?: string;
}

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokens: Token[];
  userId: string;
  onSuccess: () => void;
}

export function SendModal({ isOpen, onClose, tokens, userId, onSuccess }: SendModalProps) {
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  // Validate recipient address
  const isValidAddress = useMemo(() => {
    if (!recipientAddress) return null;
    return /^0x[a-fA-F0-9]{40}$/.test(recipientAddress);
  }, [recipientAddress]);

  // Calculate USD value of amount
  const usdValue = useMemo(() => {
    if (!amount || !selectedToken || !selectedToken.usdPrice) return 0;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return 0;
    return numAmount * selectedToken.usdPrice;
  }, [amount, selectedToken]);

  // Check if amount is valid
  const isValidAmount = useMemo(() => {
    if (!amount || !selectedToken) return null;
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return false;
    return numAmount <= parseFloat(selectedToken.balance);
  }, [amount, selectedToken]);

  // Get token icon (with fallback for native tokens)
  const getTokenIcon = (token: Token) => {
    if (token.icon) {
      return token.icon;
    }
    
    // Fallback icons for native tokens
    if (!token.contractAddress) {
      if (token.chain === 'polygon') {
        return '/assets/polygon.svg';
      }
      // ETH for base and ethereum
      return '/assets/eth.svg';
    }
    
    return null;
  };

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

    if (!isValidAddress || !isValidAmount) {
      setError('Invalid address or amount');
      return;
    }

    // All tokens are now sendable with viem fallback
    // No need to check network support anymore

    setIsSending(true);
    setError(null);
    setTxHash(null);

    try {
      const amountNum = parseFloat(amount);
      
      // Validate amount is a valid number
      if (isNaN(amountNum) || !isFinite(amountNum)) {
        throw new Error('Invalid amount');
      }
      
      // Convert amount to base units (wei/smallest unit) - avoid scientific notation
      const multiplier = Math.pow(10, selectedToken.decimals);
      const amountInBaseUnits = BigInt(Math.floor(amountNum * multiplier)).toString();

      // Determine token parameter
      let tokenParam: string;
      if (!selectedToken.contractAddress) {
        // Native token - use specific symbol for each chain
        const nativeTokenMap: Record<string, string> = {
          'base': 'eth',
          'ethereum': 'eth',
          'polygon': 'matic',
        };
        tokenParam = nativeTokenMap[selectedToken.chain.toLowerCase()] || 'eth';
      } else {
        // ERC20 token - use contract address
        tokenParam = selectedToken.contractAddress;
      }

      console.log('📤 Sending transaction:', {
        userId,
        network: selectedToken.chain,
        to: recipientAddress,
        token: tokenParam,
        amount: amountInBaseUnits,
        decimals: selectedToken.decimals,
      });

      const data = await elizaClient.cdp.sendToken({
        name: userId,
        network: selectedToken.chain,
        to: recipientAddress,
        token: tokenParam,
        amount: amountInBaseUnits,
      });

      console.log('✅ Transaction sent:', data);
      setTxHash(data.transactionHash);
      setIsSending(false);
      // Don't auto-close, let user close manually after seeing success
    } catch (err: any) {
      console.error('❌ Send failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send transaction';
      setError(errorMessage);
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
      setAmount(selectedToken.balanceFormatted);
    }
  };

  if (!isOpen) return null;

  // Success screen
  if (txHash && selectedToken) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={handleClose}>
        <div className="bg-background rounded-lg max-w-lg w-full max-h-[95vh] overflow-hidden p-1.5" onClick={(e) => e.stopPropagation()}>
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
        <div className="bg-background rounded-lg max-w-lg w-full overflow-hidden p-1.5">
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
      <div className="bg-background rounded-lg max-w-lg w-full max-h-[95vh] p-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="bg-pop rounded-lg p-4 sm:p-6 space-y-4 max-h-[calc(95vh-0.75rem)] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Send Tokens</h3>
            <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>

          {/* Token Selection */}
          <div className="space-y-2" style={{ overflow: 'visible' }}>
            <label className="text-sm font-medium">Select Token</label>
            <div className="relative" ref={dropdownRef} style={{ zIndex: 60 }}>
              {/* Dropdown Button */}
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full p-3 border border-border rounded-lg flex items-center justify-between hover:bg-accent/50 transition-colors"
              >
                {selectedToken ? (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                      {getTokenIcon(selectedToken) ? (
                        <img src={getTokenIcon(selectedToken)!} alt={selectedToken.symbol} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-muted-foreground uppercase">{selectedToken.symbol.charAt(0)}</span>
                      )}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium">{selectedToken.symbol}</p>
                      <p className="text-xs text-muted-foreground">{selectedToken.chain.toUpperCase()}</p>
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">Select a token...</span>
                )}
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {tokens.map((token, index) => (
                    <button
                      key={`${token.chain}-${token.contractAddress || token.symbol}-${index}`}
                      type="button"
                      onClick={() => {
                        setSelectedToken(token);
                        setAmount('');
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full p-3 flex items-center justify-between hover:bg-accent transition-colors ${
                        selectedToken === token ? 'bg-accent' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                          {getTokenIcon(token) ? (
                            <img src={getTokenIcon(token)!} alt={token.symbol} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-sm font-bold text-muted-foreground uppercase">{token.symbol.charAt(0)}</span>
                          )}
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium">{token.symbol}</p>
                          <p className="text-xs text-muted-foreground">{token.chain.toUpperCase()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono">{parseFloat(token.balanceFormatted).toFixed(6)}</p>
                        <p className="text-xs text-muted-foreground">${token.usdValue?.toFixed(2) || '0.00'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
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
              className={`font-mono text-sm ${
                recipientAddress && !isValidAddress ? 'border-red-500' : ''
              }`}
            />
            {recipientAddress && !isValidAddress && (
              <p className="text-xs text-red-500">Invalid address</p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Amount</label>
            <div className="relative">
              <Input
                type="text"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`font-mono pr-16 ${
                  amount && !isValidAmount ? 'border-red-500' : ''
                }`}
              />
              <button
                onClick={handleMaxClick}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                MAX
              </button>
            </div>
            {selectedToken && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Balance: {parseFloat(selectedToken.balanceFormatted).toFixed(6)} {selectedToken.symbol}</span>
                {amount && isValidAmount && <span>≈ ${usdValue.toFixed(2)}</span>}
              </div>
            )}
            {amount && !isValidAmount && (
              <p className="text-xs text-red-500">Insufficient balance</p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleClose}
              variant="outline"
              className="flex-1"
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              className="flex-1"
              disabled={
                !selectedToken ||
                !recipientAddress ||
                !amount ||
                !isValidAddress ||
                !isValidAmount ||
                isSending
              }
            >
              {isSending ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
