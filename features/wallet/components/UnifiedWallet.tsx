import React from 'react';
import SixtyWallet from './SixtyWallet';
import WalletTab from './WalletTab';

import { TransactionHistory } from '@/types/chat';

interface UnifiedWalletProps {
  // WalletTab props
  balance: number;
  setBalance: (balance: number | ((prevBalance: number) => number)) => void;
  mintUrl: string;
  baseUrl: string;
  transactionHistory: TransactionHistory[];
  setTransactionHistory: (transactionHistory: TransactionHistory[] | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])) => void;
  
  // SixtyWallet props
  usingNip60: boolean;
  setUsingNip60: (usingNip60: boolean) => void;
}

const UnifiedWallet: React.FC<UnifiedWalletProps> = ({
  balance,
  setBalance,
  mintUrl,
  baseUrl,
  transactionHistory,
  setTransactionHistory,
  usingNip60,
  setUsingNip60,
}) => {
  return (
    <div className="space-y-6">
      {/* NIP-60 Toggle */}
      <div className="bg-white/5 border border-white/10 rounded-md p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">Use NIP-60 Wallet</span>
          <button
            role="switch"
            aria-checked={usingNip60}
            onClick={() => setUsingNip60(!usingNip60)}
            className={`${
              usingNip60 ? 'bg-white' : 'bg-white/20'
            } inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer`}
          >
            <span
              className={`${
                usingNip60 ? 'translate-x-[calc(100%-2px)] bg-black' : 'translate-x-0 bg-white'
              } pointer-events-none block size-4 rounded-full ring-0 transition-transform`}
            />
          </button>
        </div>
      </div>

      {usingNip60 ? (
        <SixtyWallet 
          mintUrl={mintUrl} 
          usingNip60={usingNip60} 
          setUsingNip60={setUsingNip60} 
        />
      ) : (
        <WalletTab
          balance={balance}
          setBalance={setBalance}
          mintUrl={mintUrl}
          baseUrl={baseUrl}
          transactionHistory={transactionHistory}
          setTransactionHistory={setTransactionHistory}
        />
      )}
    </div>
  );
};

export default UnifiedWallet;