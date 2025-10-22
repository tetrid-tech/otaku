import { useState } from 'react';
import { Button } from '../../ui/button';
import { Copy, Check } from 'lucide-react';
import { useModal } from '../../../contexts/ModalContext';

interface FundModalContentProps {
  walletAddress?: string;
  shortAddress: string;
}

export function FundModalContent({ walletAddress, shortAddress }: FundModalContentProps) {
  const { hideModal } = useModal();
  const modalId = 'fund-modal';
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    
    try {
      await navigator.clipboard.writeText(walletAddress);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="space-y-4 w-full max-w-md mx-auto">
      <h3 className="text-lg font-semibold">Fund Your Wallet</h3>
      <p className="text-sm text-muted-foreground">
        Transfer ETH from another wallet or exchange
      </p>
      
      <div className="space-y-3">
        {/* Copy Address */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            Wallet Address
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted p-2 rounded font-mono flex-1">
              {shortAddress}
            </code>
            <Button
              onClick={handleCopyAddress}
              variant="ghost"
              size="sm"
              className="shrink-0"
              title="Copy full address"
            >
              {isCopied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
          {isCopied && (
            <p className="text-xs text-green-500 mt-1">
              Address copied to clipboard!
            </p>
          )}
        </div>
      </div>

      {/* Close button */}
      <Button
        onClick={() => hideModal(modalId)}
        variant="ghost"
        className="w-full"
      >
        Close
      </Button>
    </div>
  );
}

