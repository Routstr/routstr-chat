import React, { useEffect, useState } from 'react';
import { TransactionHistory } from '@/types/chat';
import { getPendingCashuTokenAmount, getPendingCashuTokenDistribution } from '../../utils/cashuUtils';

interface HistoryTabProps {
  transactionHistory: TransactionHistory[];
  setTransactionHistory: (transactionHistory: TransactionHistory[] | ((prevTransactionHistory: TransactionHistory[]) => TransactionHistory[])) => void;
  clearConversations: () => void;
  onClose: () => void;
}

const HistoryTab: React.FC<HistoryTabProps> = ({
  transactionHistory,
  setTransactionHistory,
  clearConversations,
  onClose,
}) => {
  const [pendingCashuAmount, setPendingCashuAmount] = useState<number | null>(null);
  const [pendingDistribution, setPendingDistribution] = useState<{ baseUrl: string; amount: number }[]>([]);

  useEffect(() => {
    const checkPendingCashuToken = () => {
      const amount = getPendingCashuTokenAmount();
      setPendingCashuAmount(amount > 0 ? amount : null);

      const distArray = getPendingCashuTokenDistribution();
      setPendingDistribution(distArray);
    };

    checkPendingCashuToken();
    window.addEventListener('storage', checkPendingCashuToken);
    return () => {
      window.removeEventListener('storage', checkPendingCashuToken);
    };
  }, []);

  const handleClearTransactions = () => {
    if (window.confirm('Are you sure you want to clear all transaction history? This cannot be undone.')) {
      setTransactionHistory([]);
      localStorage.removeItem('transaction_history');
      localStorage.removeItem('current_cashu_token'); // Also clear pending token
      setPendingCashuAmount(null); // Clear pending amount state
      onClose();
    }
  };

  const handleClearConversations = () => {
    if (window.confirm('Are you sure you want to clear all conversations? This cannot be undone.')) {
      clearConversations();
      onClose();
    }
  };

  return (
    <div className="space-y-6">
      {/* Transaction History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white/80">Transaction History</h3>
          <span className="text-xs text-white/50">{transactionHistory.length} transactions</span>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-md">
          {pendingCashuAmount !== null && (
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <div>
                  <div className="text-sm font-medium text-white">Pending</div>
                  {pendingDistribution.length > 0 && (
                    <div className="mt-0.5 space-y-0.5">
                      {pendingDistribution.map((item) => (
                        <div key={item.baseUrl} className="text-xs text-white/50 flex items-center gap-2">
                          <span className="truncate max-w-[200px]" title={item.baseUrl}>{item.baseUrl}</span>
                          <span className="text-white/70 font-mono">+{item.amount} sats</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-mono text-white">+{pendingCashuAmount} sats</div>
              </div>
            </div>
          )}
          {transactionHistory.length === 0 ? (
            <div className="p-4 text-center text-white/50 text-sm">
              No transactions yet
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {[...transactionHistory].reverse().map((tx, index) => (
                <div key={index} className="flex items-center justify-between p-4 border-b border-white/5 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      tx.type === 'send' || tx.type === 'spent' ? 'bg-red-500' : 'bg-green-500'
                    }`} />
                    <div>
                      <div className="text-sm font-medium text-white capitalize">{tx.type}</div>
                      <div className="text-xs text-white/50">
                        {new Date(tx.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono text-white">{ tx.type === 'send' || tx.type === 'spent' ? '-': '+'}{tx.amount} sats</div>
                    <div className="text-xs text-white/50">Balance: {tx.balance}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Data Management */}
      <div>
        <h3 className="text-sm font-medium text-red-400 mb-3">Danger Zone</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-red-500/5 border border-red-500/20 rounded-md">
            <div>
              <div className="text-sm text-white">Clear Conversations</div>
              <div className="text-xs text-white/50">Remove all chat history</div>
            </div>
            <button
              onClick={handleClearConversations}
              className="px-3 py-1.5 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-colors"
              type="button"
            >
              Clear
            </button>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-red-500/5 border border-red-500/20 rounded-md">
            <div>
              <div className="text-sm text-white">Clear Transactions</div>
              <div className="text-xs text-white/50">Remove all payment records</div>
            </div>
            <button
              onClick={handleClearTransactions}
              className="px-3 py-1.5 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-colors"
              type="button"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HistoryTab;