import React from 'react';
import SixtyWallet from './SixtyWallet';
import WalletTab from './WalletTab';

interface UnifiedWalletProps {
  // WalletTab props
  balance: number;
  error: string;
  successMessage: string;
  mintAmount: string;
  setMintAmount: (amount: string) => void;
  createMintQuote: () => Promise<void>;
  isMinting: boolean;
  mintInvoice: string;
  setShowInvoiceModal: (show: boolean) => void;
  isAutoChecking: boolean;
  countdown: number;
  sendAmount: string;
  setSendAmount: (amount: string) => void;
  generateSendToken: () => Promise<void>;
  isGeneratingSendToken: boolean;
  generatedToken: string;
  tokenToImport: string;
  setTokenToImport: (token: string) => void;
  importToken: () => Promise<void>;
  isImporting: boolean;
  
  // SixtyWallet props
  mintUrl: string;
  usingNip60: boolean;
  setUsingNip60: (usingNip60: boolean) => void;
}

const UnifiedWallet: React.FC<UnifiedWalletProps> = ({
  usingNip60,
  setUsingNip60,
  mintUrl,
  ...walletTabProps
}) => {
  return (
    <div className="space-y-6">
      {/* NIP-60 Toggle */}
      <div className="bg-white/5 border border-white/10 rounded-md p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-white/70">Use NIP-60 Wallet</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={usingNip60}
              onChange={(e) => setUsingNip60(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>

      {usingNip60 ? (
        <SixtyWallet 
          mintUrl={mintUrl} 
          usingNip60={usingNip60} 
          setUsingNip60={setUsingNip60} 
        />
      ) : (
        <WalletTab {...walletTabProps} />
      )}
    </div>
  );
};

export default UnifiedWallet;