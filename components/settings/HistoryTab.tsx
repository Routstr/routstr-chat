import React from 'react';
import { TransactionHistory } from '@/types/chat';

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
  const handleClearTransactions = () => {
    if (window.confirm('Are you sure you want to clear all transaction history? This cannot be undone.')) {
      setTransactionHistory([]);
      localStorage.removeItem('transaction_history');
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
                      tx.status === 'success' ? 'bg-green-500' : 'bg-red-500'
                    }`} />
                    <div>
                      <div className="text-sm font-medium text-white capitalize">{tx.type}</div>
                      <div className="text-xs text-white/50">
                        {new Date(tx.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono text-white">{tx.amount} sats</div>
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