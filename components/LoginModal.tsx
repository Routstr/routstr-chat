'use client';

import { useRef, useState } from 'react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useProfileSync } from '@/hooks/useProfileSync';
import { Shield, Upload } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void; // Added for consistency with LoginDialog
}

export default function LoginModal({ isOpen, onClose, onLogin }: LoginModalProps) {
  const [activeTab, setActiveTab] = useState<'extension' | 'key' | 'bunker' | 'signup'>('extension');
  const [nsec, setNsec] = useState('');
  const [bunkerUri, setBunkerUri] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // For signup
  const [generatedNsec, setGeneratedNsec] = useState<string | null>(null);
  const [generatedNpub, setGeneratedNpub] = useState<string | null>(null);
  const [npubCopied, setNpubCopied] = useState(false);
  const [nsecCopied, setNsecCopied] = useState(false);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [showNsec, setShowNsec] = useState(false);

  const loginActions = useLoginActions();
  const { syncProfile } = useProfileSync();

  const handleExtensionLogin = async () => {
    setIsLoading(true);
    try {
      if (!('nostr' in window)) {
        throw new Error('Nostr extension not found. Please install a NIP-07 extension.');
      }
      const loginInfo = await loginActions.extension();
      
      // Sync profile after successful login
      await syncProfile(loginInfo.pubkey);
      
      onLogin();
      onClose();
    } catch (error) {
      console.error('Extension login failed:', error);
      setError('Extension login failed: ' + (error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyLogin = async () => {
    if (!nsec.trim()) return;
    setIsLoading(true);

    try {
      const loginInfo = loginActions.nsec(nsec);
      
      // Sync profile after successful login
      await syncProfile(loginInfo.pubkey);
      
      onLogin();
      onClose();
    } catch (error) {
      console.error('Nsec login failed:', error);
      setError('Nsec login failed: ' + (error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBunkerLogin = async () => {
    if (!bunkerUri.trim() || !bunkerUri.startsWith('bunker://')) return;
    setIsLoading(true);

    try {
      const loginInfo = await loginActions.bunker(bunkerUri);
      
      // Sync profile after successful login
      await syncProfile(loginInfo.pubkey);
      
      onLogin();
      onClose();
    } catch (error) {
      console.error('Bunker login failed:', error);
      setError('Bunker login failed: ' + (error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setNsec(content.trim());
    };
    reader.readAsText(file);
  };

  const generateNewKeypair = () => {
    try {
      // Generate a new keypair
      const secretKey = generateSecretKey();
      const publicKey = getPublicKey(secretKey);

      // Encode to bech32 format
      const nsecEncoded = nip19.nsecEncode(secretKey);
      const npubEncoded = nip19.npubEncode(publicKey);

      // Set the generated keys
      setGeneratedNsec(nsecEncoded);
      setGeneratedNpub(npubEncoded);

      // Reset states
      setNpubCopied(false);
      setNsecCopied(false);
      setShowSaveConfirmation(false);
      setShowNsec(false);
    } catch (error) {
      console.error('Error generating keypair:', error);
      setError('Failed to generate new keys. Please try again.');
    }
  };

  const copyToClipboard = (text: string, type: 'npub' | 'nsec') => {
    navigator.clipboard.writeText(text).then(
      () => {
        if (type === 'npub') {
          setNpubCopied(true);
          setTimeout(() => setNpubCopied(false), 3000);
        } else {
          setNsecCopied(true);
          setTimeout(() => setNsecCopied(false), 3000);
        }
      },
      (err) => {
        console.error('Failed to copy:', err);
      }
    );
  };

  const confirmKeysSaved = () => {
    setShowSaveConfirmation(true);
  };

  const completeSignup = async () => { // Made async
    // Login with the generated nsec key
    if (generatedNsec) {
      try {
        const loginInfo = loginActions.nsec(generatedNsec);
        await syncProfile(loginInfo.pubkey);
        onLogin();
        onClose();
      } catch (error) {
        console.error('Failed to login with generated key:', error);
        setError('Failed to login with the generated key: ' + (error as Error).message);
      }
    }
  };

  const toggleShowNsec = () => {
    setShowNsec(!showNsec);
  };

  // Function to mask the nsec key for display
  const maskNsecKey = (nsec: string) => {
    if (!nsec) return '';
    // Keep the first 6 and last 4 characters, mask the rest
    const prefix = nsec.substring(0, 6);
    const suffix = nsec.substring(nsec.length - 4);
    return `${prefix}${'•'.repeat(Math.min(20, nsec.length - 10))}${suffix}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-white/10 rounded-xl max-w-sm w-full p-5 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-white/50 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className='text-xl font-semibold text-center text-white'>Log in</h2>
        <p className='text-center text-muted-foreground mt-2 text-xs text-gray-400'>
          Access your account securely with your preferred method
        </p>

        {/* Tabs */}
        <div className="flex mb-4 bg-white/5 p-0.5 rounded-lg gap-1">
          <button
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'extension'
              ? 'bg-white text-black'
              : 'text-white hover:bg-white/10'
              }`}
            onClick={() => setActiveTab('extension')}
          >
            Extension
          </button>
          <button
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'key'
              ? 'bg-white text-black'
              : 'text-white hover:bg-white/10'
              }`}
            onClick={() => setActiveTab('key')}
          >
            Nsec
          </button>
          <button
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'bunker'
              ? 'bg-white text-black'
              : 'text-white hover:bg-white/10'
              }`}
            onClick={() => setActiveTab('bunker')}
          >
            Bunker
          </button>
          <button
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'signup'
              ? 'bg-white text-black'
              : 'text-white hover:bg-white/10'
              }`}
            onClick={() => setActiveTab('signup')}
          >
            Sign Up
          </button>
        </div>

        {/* Extension Tab */}
        {activeTab === 'extension' && (
          <div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-4">
              <h3 className="text-sm font-medium text-white mb-2">Connect with Extension</h3>
              <p className="text-xs text-gray-400 mb-3">
                Login with one click using the browser extension
              </p>

              <button
                onClick={handleExtensionLogin}
                disabled={isLoading}
                className="w-full py-2 bg-white text-black rounded-md text-xs font-medium flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                {isLoading ? (
                  <div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Shield className='w-3 h-3 mr-1.5' />
                    Login with Extension
                  </>
                )}
              </button>

              {error && (
                <p className="mt-2 text-xs text-red-400">{error}</p>
              )}
            </div>
          </div>
        )}

        {/* Nsec Key Tab */}
        {activeTab === 'key' && (
          <div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-4">
              <div className="mb-3">
                <label htmlFor="nsec" className="block text-xs font-medium text-gray-400 mb-1">
                  Enter your nsec
                </label>
                <input
                  id="nsec"
                  type="password"
                  value={nsec}
                  onChange={(e) => setNsec(e.target.value)}
                  placeholder="nsec1..."
                  className="w-full px-2.5 py-1.5 bg-black/50 border border-white/10 rounded-md text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                />
                {error && (
                  <p className="mt-1 text-xs text-red-400">{error}</p>
                )}
              </div>

              <div className='text-center'>
                <div className='text-sm mb-2 text-muted-foreground text-gray-400'>Or upload a key file</div>
                <input
                  type='file'
                  accept='.txt'
                  className='hidden'
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                <button
                  className='w-full py-2 bg-white text-black rounded-md text-xs font-medium hover:bg-gray-200 transition-colors'
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className='w-3 h-3 mr-1.5' />
                  Upload Nsec File
                </button>
              </div>

              <button
                type="button"
                onClick={handleKeyLogin}
                disabled={isLoading || !nsec.trim()}
                className="w-full py-2 bg-white text-black rounded-md text-xs font-medium hover:bg-gray-200 transition-colors mt-4"
              >
                {isLoading ? 'Verifying...' : 'Login with Nsec'}
              </button>
            </div>
          </div>
        )}

        {/* Bunker Tab */}
        {activeTab === 'bunker' && (
          <div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-4">
              <div className="mb-3">
                <label htmlFor="bunkerUri" className="block text-xs font-medium text-gray-400 mb-1">
                  Bunker URI
                </label>
                <input
                  id="bunkerUri"
                  type="text"
                  value={bunkerUri}
                  onChange={(e) => setBunkerUri(e.target.value)}
                  placeholder="bunker://..."
                  className="w-full px-2.5 py-1.5 bg-black/50 border border-white/10 rounded-md text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                />
                {bunkerUri && !bunkerUri.startsWith('bunker://') && (
                  <div className='text-destructive text-xs text-red-400'>URI must start with bunker://</div>
                )}
              </div>

              <button
                type="button"
                onClick={handleBunkerLogin}
                disabled={isLoading || !bunkerUri.trim() || !bunkerUri.startsWith('bunker://')}
                className="w-full py-2 bg-white text-black rounded-md text-xs font-medium hover:bg-gray-200 transition-colors"
              >
                {isLoading ? 'Connecting...' : 'Login with Bunker'}
              </button>
            </div>
          </div>
        )}

        {/* Sign Up Tab */}
        {activeTab === 'signup' && (
          <div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-4">
              <h3 className="text-sm font-medium text-white mb-2">Create New Account</h3>
              <p className="text-xs text-gray-400 mb-3">
                Generate a new Nostr identity to get started. Make sure to save your private key securely.
              </p>

              {!generatedNsec ? (
                <button
                  onClick={generateNewKeypair}
                  className="w-full py-2 bg-white text-black rounded-md text-xs font-medium hover:bg-gray-200 transition-colors"
                >
                  Generate New Keys
                </button>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-medium text-gray-400">
                        Your Public Key (npub)
                      </label>
                      {generatedNpub && (
                        <button
                          onClick={() => copyToClipboard(generatedNpub, 'npub')}
                          className="text-xs text-white/70 hover:text-white"
                        >
                          {npubCopied ? 'Copied!' : 'Copy'}
                        </button>
                      )}
                    </div>
                    <div className="px-2.5 py-1.5 bg-black/50 border border-white/10 rounded-md text-xs text-gray-300 break-all">
                      {generatedNpub || 'Error generating key'}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-medium text-red-400">
                        Your Private Key (nsec) - SAVE THIS!
                      </label>
                      <div className="flex items-center gap-2">
                        {generatedNsec && (
                          <button
                            onClick={() => copyToClipboard(generatedNsec, 'nsec')}
                            className="text-xs text-white/70 hover:text-white"
                          >
                            {nsecCopied ? 'Copied!' : 'Copy'}
                          </button>
                        )}
                        <button
                          onClick={toggleShowNsec}
                          className="text-xs text-white/70 hover:text-white"
                        >
                          {showNsec ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                    <div className="px-2.5 py-1.5 bg-red-950/20 border border-red-500/20 rounded-md text-xs text-gray-300 break-all">
                      {generatedNsec
                        ? (showNsec ? generatedNsec : maskNsecKey(generatedNsec))
                        : 'Error generating key'
                      }
                    </div>
                  </div>

                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2">
                    <p className="text-xs text-yellow-200/70">
                      <span className="font-bold">Important:</span> Your private key is your identity. Save it securely and never share it.
                    </p>
                  </div>

                  <div className="flex items-center">
                    <input
                      id="saved-key"
                      type="checkbox"
                      checked={showSaveConfirmation}
                      onChange={confirmKeysSaved}
                      className="h-3 w-3 bg-black border border-white/30 rounded"
                    />
                    <label htmlFor="saved-key" className="ml-2 text-xs text-gray-300">
                      I&apos;ve saved my private key securely
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={completeSignup}
                    disabled={!showSaveConfirmation}
                    className={`w-full py-2 rounded-md text-xs font-medium ${showSaveConfirmation
                      ? 'bg-white text-black hover:bg-gray-200'
                      : 'bg-white/20 text-white/50 cursor-not-allowed'
                      }`}
                  >
                    Complete Sign Up
                  </button>
                </div>
              )}

              {error && (
                <p className="mt-2 text-xs text-red-400">{error}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 