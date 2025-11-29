'use client';

import { useRef, useState, useEffect } from 'react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useLoggedInAccounts } from '@/hooks/useLoggedInAccounts';
import { Shield, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { hasCreatedEphemeralNsec, markEphemeralNsecDeleted } from '@/utils/storageUtils';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: () => void;
  logout: () => void;
}

type SignupStep = 'initial' | 'save-keys';

export default function LoginModal({ isOpen, onClose, onLogin, logout }: LoginModalProps) {
  const [nsec, setNsec] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Signup state
  const [signupStep, setSignupStep] = useState<SignupStep>('initial');
  const [generatedNsec, setGeneratedNsec] = useState<string | null>(null);
  const [generatedNpub, setGeneratedNpub] = useState<string | null>(null);
  const [nsecCopied, setNsecCopied] = useState(false);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [showNsec, setShowNsec] = useState(false);

  // Mobile tab state
  const [activeTab, setActiveTab] = useState<'create' | 'signin'>('signin');

  const loginActions = useLoginActions();
  const { setLogin } = useLoggedInAccounts();

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setNsec('');
      setSignupStep('initial');
      setGeneratedNsec(null);
      setGeneratedNpub(null);
      setShowSaveConfirmation(false);
      setShowNsec(false);
      setNsecCopied(false);
      setActiveTab('signin');
    }
  }, [isOpen]);

  const handleExtensionLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!('nostr' in window)) {
        throw new Error('Nostr extension not found. Please install a NIP-07 extension.');
      }
      if (hasCreatedEphemeralNsec()) {
        logout()
        markEphemeralNsecDeleted()
      }
      const login = await loginActions.extension();
      setLogin(login.id);
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
    setError(null);

    try {
      if (hasCreatedEphemeralNsec()) {
        logout()
        markEphemeralNsecDeleted()
      }
      const login = loginActions.nsec(nsec);
      setLogin(login.id);
      onLogin();
      onClose();
    } catch (error) {
      console.error('Nsec login failed:', error);
      setError('Nsec login failed: ' + (error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const generateNewKeypair = () => {
    try {
      const secretKey = generateSecretKey();
      const publicKey = getPublicKey(secretKey);
      const nsecEncoded = nip19.nsecEncode(secretKey);
      const npubEncoded = nip19.npubEncode(publicKey);

      setGeneratedNsec(nsecEncoded);
      setGeneratedNpub(npubEncoded);
      setNsecCopied(false);
      setShowSaveConfirmation(false);
      setShowNsec(false);
      setSignupStep('save-keys');
    } catch (error) {
      console.error('Error generating keypair:', error);
      setError('Failed to generate new keys. Please try again.');
    }
  };

  const copyToClipboard = async (text: string, type: 'npub' | 'nsec') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'nsec') {
          setNsecCopied(true);
        setTimeout(() => setNsecCopied(false), 2000);
        }
    } catch (err) {
        console.error('Failed to copy:', err);
      }
  };

  const completeSignup = async () => {
    if (generatedNsec) {
      try {
        const login = loginActions.nsec(generatedNsec);
        setLogin(login.id);
        onLogin();
        onClose();
      } catch (error) {
        console.error('Failed to login with generated key:', error);
        setError('Failed to login with the generated key: ' + (error as Error).message);
      }
    }
  };

  const handleSaveLater = async () => {
    localStorage.setItem('nsec_storing_skipped', 'true');
    await completeSignup();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 backdrop-blur-md bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-black/90 backdrop-blur-xl border-2 border-white/20 rounded-xl max-w-2xl w-full p-4 md:p-6 relative shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-white/50 hover:text-white transition-colors z-10 cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Welcome Section */}
        <div className="text-center mb-6">
          <h2 className="text-xl md:text-2xl font-bold text-white mb-2">Welcome to Routstr Chat</h2>
          <p className="text-sm text-gray-400">A decentralized LLM routing marketplace</p>
        </div>

        {/* Mobile Tabs */}
        <div className="md:hidden mb-4">
          <div className="flex bg-white/5 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('create')}
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'create'
                  ? 'bg-white text-black'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              Create Account
            </button>
            <button
              onClick={() => setActiveTab('signin')}
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'signin'
                  ? 'bg-white text-black'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              Sign In
            </button>
          </div>
        </div>

        {/* Responsive Layout */}
        <div className="flex flex-col md:flex-row gap-4 md:gap-6">
          
          {/* Signup Section - Top on mobile, Left on desktop */}
          <div className={`w-full md:w-1/2 order-2 md:order-1 ${activeTab === 'create' ? 'block' : 'hidden md:block'}`}>
            <div className="p-3 md:p-4 flex flex-col h-full">
              <div className="hidden md:block text-center pb-3 md:pb-2 border-b border-white/10 mb-4 md:mb-3">
                <h3 className="text-lg md:text-base font-semibold text-white mb-1">Create Account</h3>
                <p className="text-sm md:text-xs text-gray-400">New to Nostr?</p>
              </div>

              <div className="flex-1 flex flex-col">
                {signupStep === 'initial' && (
                  <div className="flex flex-col h-full">
                    <div className="mb-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                          <span className="text-xs text-gray-300">Multiple AI models, always the best price</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                          <span className="text-xs text-gray-300">Pay with Bitcoin (Lightning or on-chain)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                          <span className="text-xs text-gray-300">Private, permissionless, open source</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                          <span className="text-xs text-gray-300">Powered by Nostr + Cashu tokens</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1"></div>

                    <div className="space-y-3">
                      <button
                        onClick={generateNewKeypair}
                        className="w-full py-3 md:py-2.5 bg-white text-black rounded-lg text-base md:text-sm font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
                      >
                        Generate New Identity
                      </button>
                    </div>
                  </div>
                )}

                {signupStep === 'save-keys' && generatedNsec && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-white font-medium mb-2 text-center">Save your private key!</p>
                      
                      {/* Private Key Display */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-medium text-red-400">Private Key</label>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setShowNsec(!showNsec)}
                              className="text-xs text-white/70 hover:text-white transition-colors cursor-pointer"
                            >
                              {showNsec ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={() => copyToClipboard(generatedNsec, 'nsec')}
                              className="text-xs text-white/70 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              {nsecCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                              {nsecCopied ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                        </div>
                        <div className="px-2 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-gray-300 break-all font-mono">
                          {showNsec ? generatedNsec : generatedNsec.substring(0, 8) + '•'.repeat(20) + generatedNsec.substring(generatedNsec.length - 8)}
                        </div>
                      </div>

                      {/* Confirmation Checkbox */}
                      <div className="flex items-start gap-2 p-2 bg-white/5 border border-white/10 rounded-lg">
                        <input
                          id="saved-confirmation"
                          type="checkbox"
                          checked={showSaveConfirmation}
                          onChange={(e) => setShowSaveConfirmation(e.target.checked)}
                          className="mt-0.5 h-3 w-3 bg-transparent border border-white/30 rounded focus:ring-0 focus:ring-offset-0 cursor-pointer"
                        />
                        <label htmlFor="saved-confirmation" className="text-xs text-gray-300 cursor-pointer">
                          I have saved my private key securely
                        </label>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <button
                        onClick={completeSignup}
                        disabled={!showSaveConfirmation}
                        className="w-full py-3 md:py-2 bg-white text-black rounded-lg text-base md:text-sm font-semibold hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        Complete Setup
                      </button>

                      <button
                        onClick={handleSaveLater}
                        className="w-full py-2.5 md:py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-sm md:text-xs font-medium hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        I'll Save It Later
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sign In Section - Top on mobile, Right on desktop */}
          <div className={`w-full md:w-1/2 order-1 md:order-2 p-3 md:p-4 ${activeTab === 'signin' ? 'block' : 'hidden md:block'}`}>
            <div className="hidden md:block text-center pb-2 border-b border-white/10">
              <h3 className="text-base font-semibold text-white mb-1">Sign In</h3>
              <p className="text-xs text-gray-400">Already have an account?</p>
            </div>

            <div className="mt-0 md:mt-3 space-y-3">
              {/* Extension Login */}
              <button
                onClick={handleExtensionLogin}
                disabled={isLoading}
                className="w-full py-2.5 bg-white/10 border border-white/20 text-white rounded-lg text-sm font-medium hover:bg-white/20 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    Browser Extension
                  </>
                )}
              </button>

              {/* OR Separator */}
              <div className="relative flex items-center justify-center">
                <div className="flex-grow border-t border-white/10"></div>
                <span className="flex-shrink mx-3 text-white/50 text-xs font-medium">OR</span>
                <div className="flex-grow border-t border-white/10"></div>
              </div>

              {/* Private Key Login */}
              <div>
                <label htmlFor="nsec" className="block text-sm font-medium text-white mb-2">
                  Private Key (nsec)
                </label>
                <input
                  id="nsec"
                  type="password"
                  value={nsec}
                  onChange={(e) => setNsec(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleKeyLogin();
                    }
                  }}
                  placeholder="nsec1..."
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition-colors"
                />
              </div>

              <button
                onClick={handleKeyLogin}
                disabled={isLoading || !nsec.trim()}
                className="w-full py-2.5 bg-white text-black rounded-lg text-sm font-semibold hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {isLoading ? 'Signing In...' : 'Sign In'}
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
              {error && (
          <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <p className="text-sm text-red-400 text-center">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}