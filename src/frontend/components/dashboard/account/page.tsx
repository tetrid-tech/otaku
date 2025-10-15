import { useState, useRef, useEffect } from 'react';
import DashboardPageLayout from "@/components/dashboard/layout";
import DashboardCard from "@/components/dashboard/card";
import MonkeyIcon from "@/components/icons/monkey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCDPWallet } from '@/hooks/useCDPWallet';
import { Copy, Check, Loader2 } from 'lucide-react';

interface AccountPageProps {
  totalBalance?: number;
  userProfile: {
    avatarUrl: string;
    displayName: string;
    bio: string;
    email: string;
    walletAddress: string;
    memberSince: string;
  } | null;
  onUpdateProfile: (updates: {
    avatarUrl?: string;
    displayName?: string;
    bio?: string;
  }) => Promise<void>;
}

// Status Modal Component
function StatusModal({ 
  type, 
  message, 
  onClose 
}: { 
  type: 'loading' | 'success' | 'error';
  message: string;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-card border-2 border-border rounded-lg p-8 flex flex-col items-center gap-4 min-w-[300px]">
        {type === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-lg font-mono uppercase tracking-wider text-center">{message}</p>
          </>
        )}
        
        {type === 'success' && (
          <>
            <div className="h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="h-8 w-8 text-green-500" />
            </div>
            <p className="text-lg font-mono uppercase tracking-wider text-center">{message}</p>
            {onClose && (
              <Button onClick={onClose} className="mt-2 w-full">
                Close
              </Button>
            )}
          </>
        )}
        
        {type === 'error' && (
          <>
            <div className="h-12 w-12 rounded-full bg-destructive/20 flex items-center justify-center">
              <svg 
                className="h-8 w-8 text-destructive" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M6 18L18 6M6 6l12 12" 
                />
              </svg>
            </div>
            <p className="text-lg font-mono uppercase tracking-wider text-center">{message}</p>
            <p className="text-sm text-muted-foreground text-center">Please try again</p>
            {onClose && (
              <Button onClick={onClose} variant="destructive" className="mt-2 w-full">
                Close
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Compress and convert image to base64
async function compressImage(file: File, maxSizeKB: number = 500): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Resize if too large (max 800px)
        const maxDimension = 300;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        // Try different quality levels until we meet the size requirement
        let quality = 0.9;
        let base64 = canvas.toDataURL('image/jpeg', quality);
        
        while (base64.length > maxSizeKB * 1024 && quality > 0.1) {
          quality -= 0.1;
          base64 = canvas.toDataURL('image/jpeg', quality);
        }
        
        resolve(base64);
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export default function AccountPage({ totalBalance = 0, userProfile, onUpdateProfile }: AccountPageProps) {
  const { signOut } = useCDPWallet();
  const [isCopied, setIsCopied] = useState(false);
  const [modalState, setModalState] = useState<{
    show: boolean;
    type: 'loading' | 'success' | 'error';
    message: string;
  }>({ show: false, type: 'loading', message: '' });
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isInitialized = useRef(false);

  // Initialize state from userProfile when it becomes available
  useEffect(() => {
    if (userProfile && !isInitialized.current) {
      setDisplayName(userProfile.displayName);
      setBio(userProfile.bio);
      isInitialized.current = true;
    }
  }, [userProfile]);

  // Dummy data
  const memberSince = userProfile?.memberSince 
    ? new Date(userProfile.memberSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'Oct 2024';
  const points = 0;
  const weekStreak = 0;
  const swapsCompleted = 0;

  const handleCopyAddress = async () => {
    if (!userProfile?.walletAddress) return;
    
    try {
      await navigator.clipboard.writeText(userProfile.walletAddress);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setModalState({ show: true, type: 'error', message: 'Invalid file type' });
      return;
    }

    // Validate file size (max 5MB before compression)
    if (file.size > 5 * 1024 * 1024) {
      setModalState({ show: true, type: 'error', message: 'Image too large (max 5MB)' });
      return;
    }

    try {
      setModalState({ show: true, type: 'loading', message: 'Uploading image...' });

      // Compress and convert to base64
      const base64Image = await compressImage(file, 500); // Max 500KB after compression

      // Update profile
      await onUpdateProfile({ avatarUrl: base64Image });

      // Show success
      setModalState({ show: true, type: 'success', message: 'Image uploaded!' });

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to upload image:', error);
      setModalState({ show: true, type: 'error', message: 'Upload failed' });
    }
  };

  const handleRemoveImage = async () => {
    try {
      setModalState({ show: true, type: 'loading', message: 'Removing image...' });
      
      await onUpdateProfile({ avatarUrl: '/avatars/user_krimson.png' });
      
      setModalState({ show: true, type: 'success', message: 'Image removed!' });
    } catch (error) {
      console.error('Failed to remove image:', error);
      setModalState({ show: true, type: 'error', message: 'Remove failed' });
    }
  };

  const handleSaveChanges = async () => {
    if (!displayName.trim()) {
      setModalState({ show: true, type: 'error', message: 'Name cannot be empty' });
      return;
    }

    try {
      setModalState({ show: true, type: 'loading', message: 'Saving changes...' });
      
      await onUpdateProfile({
        displayName: displayName.trim(),
        bio: bio.trim(),
      });

      setModalState({ show: true, type: 'success', message: 'Changes saved!' });
    } catch (error) {
      console.error('Failed to save changes:', error);
      setModalState({ show: true, type: 'error', message: 'Save failed' });
    }
  };

  return (
    <>
      {modalState.show && (
        <StatusModal 
          type={modalState.type}
          message={modalState.message}
          onClose={modalState.type !== 'loading' ? () => setModalState({ ...modalState, show: false }) : undefined}
        />
      )}
      
      <DashboardPageLayout
        header={{
          title: "Account",
          description: "Your profile and account information",
          icon: MonkeyIcon,
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <DashboardCard title="Profile Picture">
              <div className="flex flex-col items-center gap-4">
                <div className="size-32 rounded-lg overflow-hidden bg-muted">
                  <img
                    src={userProfile?.avatarUrl || '/avatars/user_krimson.png'}
                    alt={userProfile?.displayName || 'User'}
                    className="w-full h-full object-cover"
                  />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <div className="flex gap-2 w-full">
                  <Button 
                    variant="outline" 
                    className="flex-1 bg-transparent" 
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Change
                  </Button>
                  <Button 
                    variant="outline" 
                    className="flex-1 bg-transparent" 
                    size="sm"
                    onClick={handleRemoveImage}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </DashboardCard>

            <DashboardCard title="Account Status" className="mt-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Tier</span>
                  <Badge variant="secondary">Bronze</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Member Since</span>
                  <span className="text-sm font-mono">{memberSince}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Points</span>
                  <span className="text-sm font-mono">{points}</span>
                </div>
              </div>
            </DashboardCard>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <DashboardCard title="Personal Information">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      value={userProfile?.email || ''}
                      disabled
                      className="bg-muted cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="display-name">Display Name</Label>
                    <Input 
                      id="display-name" 
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wallet">Wallet Address</Label>
                  <div className="relative">
                    <Input 
                      id="wallet" 
                      value={userProfile?.walletAddress || ''}
                      disabled
                      className="bg-muted cursor-not-allowed font-mono text-sm pr-10"
                    />
                    <button
                      onClick={handleCopyAddress}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-accent rounded transition-colors"
                      title="Copy address"
                      type="button"
                    >
                      {isCopied ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bio">Bio</Label>
                  <Input 
                    id="bio" 
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                  />
                </div>
                <Button onClick={handleSaveChanges}>Save Changes</Button>
              </div>
            </DashboardCard>

            <DashboardCard title="Activity Summary">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold font-mono">{points}</div>
                  <div className="text-xs text-muted-foreground uppercase mt-1">Total Points</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold font-mono">{weekStreak}</div>
                  <div className="text-xs text-muted-foreground uppercase mt-1">Week Streak</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold font-mono">${totalBalance.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground uppercase mt-1">Wallet Balance</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold font-mono">{swapsCompleted}</div>
                  <div className="text-xs text-muted-foreground uppercase mt-1">Swaps Completed</div>
                </div>
              </div>
            </DashboardCard>

            <DashboardCard title="Danger Zone">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border border-destructive/20 bg-destructive/5">
                  <div>
                    <div className="font-medium text-sm">Sign Out</div>
                    <div className="text-xs text-muted-foreground">Sign out from your CDP wallet</div>
                  </div>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={signOut}
                  >
                    Sign Out
                  </Button>
                </div>
              </div>
            </DashboardCard>
          </div>
        </div>
      </DashboardPageLayout>
    </>
  );
}
