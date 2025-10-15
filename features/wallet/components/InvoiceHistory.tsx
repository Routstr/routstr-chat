import React, { useMemo, useState } from 'react';
import { useInvoiceSync, StoredInvoice } from '@/hooks/useInvoiceSync';
import { MintQuoteState, MeltQuoteState } from '@cashu/cashu-ts';
import { formatBalance } from '@/lib/cashu';
import { Clock, CheckCircle, XCircle, AlertCircle, Zap, Copy, RefreshCw, Trash2, RotateCcw } from 'lucide-react';
import { useInvoiceChecker } from '@/hooks/useInvoiceChecker';
import { toast } from 'sonner';

interface InvoiceHistoryProps {
  mintUrl?: string;
}

const InvoiceHistory: React.FC<InvoiceHistoryProps> = ({ mintUrl }) => {
  const { invoices, cloudSyncEnabled, deleteInvoice, resetInvoiceRetry } = useInvoiceSync();
  const { isChecking, pendingCount, triggerCheck } = useInvoiceChecker();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filteredInvoices = useMemo(() => {
    let filtered = [...invoices];
    
    if (mintUrl) {
      filtered = filtered.filter(inv => inv.mintUrl === mintUrl);
    }
    
    // Sort by creation date, newest first
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [invoices, mintUrl]);

  const getStatusIcon = (invoice: StoredInvoice) => {
    const isPaid = (invoice.state as string) === 'PAID' || (invoice.state as string) === 'ISSUED';
    const isExpired = invoice.expiresAt && Date.now() > invoice.expiresAt;
    
    if (isPaid) {
      return <CheckCircle className="h-4 w-4 text-green-400" />;
    } else if (isExpired) {
      return <XCircle className="h-4 w-4 text-red-400" />;
    } else {
      return <Clock className="h-4 w-4 text-yellow-400 animate-pulse" />;
    }
  };

  const getStatusText = (invoice: StoredInvoice) => {
    const isPaid = (invoice.state as string) === 'PAID' || (invoice.state as string) === 'ISSUED';
    const isExpired = invoice.expiresAt && Date.now() > invoice.expiresAt;
    
    if (isPaid) {
      return 'Paid';
    } else if (isExpired) {
      return 'Expired';
    } else {
      return 'Pending';
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const truncateInvoice = (invoice: string) => {
    if (invoice.length <= 20) return invoice;
    return `${invoice.slice(0, 10)}...${invoice.slice(-10)}`;
  };

  if (filteredInvoices.length === 0) {
    return (
      <div className="text-center py-8 text-white/50">
        <Zap className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No lightning invoices yet</p>
        <p className="text-xs mt-1">Your invoice history will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Bar */}
      <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-md p-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-white/70" />
          <span className="text-sm text-white/70">
            {pendingCount > 0 ? `${pendingCount} pending invoice${pendingCount > 1 ? 's' : ''}` : 'All invoices processed'}
          </span>
        </div>
        <button
          onClick={triggerCheck}
          disabled={isChecking}
          className="flex items-center gap-2 px-3 py-1 bg-white/10 border border-white/20 rounded-md text-xs text-white hover:bg-white/15 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`} />
          {isChecking ? 'Checking...' : 'Check Now'}
        </button>
      </div>

      {/* Cloud Sync Status */}
      {cloudSyncEnabled && (
        <div className="text-xs text-white/50 text-center">
          Cloud sync enabled • Invoices are backed up via NIP-44
        </div>
      )}

      {/* Invoice List */}
      <div className="space-y-2">
        {filteredInvoices.map((invoice) => (
          <div
            key={invoice.id}
            className="bg-white/5 border border-white/10 rounded-md p-3 hover:bg-white/10 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {getStatusIcon(invoice)}
                  <span className="text-sm font-medium text-white">
                    {invoice.type === 'mint' ? 'Receive' : 'Send'}
                  </span>
                  <span className="text-sm text-white/70">
                    {formatBalance(invoice.amount, 'sats')}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    getStatusText(invoice) === 'Paid' 
                      ? 'bg-green-500/20 text-green-400'
                      : getStatusText(invoice) === 'Expired'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {getStatusText(invoice)}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span>{formatDate(invoice.createdAt)}</span>
                  {invoice.paidAt && (
                    <>
                      <span>•</span>
                      <span>Paid {formatDate(invoice.paidAt)}</span>
                    </>
                  )}
                  {invoice.fee !== undefined && invoice.fee > 0 && (
                    <>
                      <span>•</span>
                      <span>Fee: {formatBalance(invoice.fee, 'sats')}</span>
                    </>
                  )}
                </div>
                
                <div className="flex items-center gap-2 mt-2">
                  <code className="text-xs text-white/50 font-mono">
                    {truncateInvoice(invoice.paymentRequest)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(invoice.paymentRequest)}
                    className="text-white/50 hover:text-white transition-colors"
                    title="Copy invoice"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                
                {/* Manual controls */}
                <div className="flex items-center gap-2 mt-2">
                  {getStatusText(invoice) === 'Pending' && (invoice.retryCount || 0) > 0 && (
                    <button
                      onClick={async () => {
                        await resetInvoiceRetry(invoice.id);
                        toast.info('Invoice retry reset');
                        triggerCheck();
                      }}
                      className="text-xs text-yellow-400 hover:text-yellow-300 flex items-center gap-1"
                      title={`Retry (${invoice.retryCount || 0} attempts)`}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Retry Now
                    </button>
                  )}
                  
                  {(getStatusText(invoice) === 'Expired' || (invoice.retryCount || 0) >= 10) && (
                    <>
                      {confirmDelete === invoice.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400">Delete?</span>
                          <button
                            onClick={async () => {
                              await deleteInvoice(invoice.id);
                              toast.success('Invoice deleted');
                              setConfirmDelete(null);
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs text-white/50 hover:text-white/70"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(invoice.id)}
                          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                          title="Delete invoice"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      )}
                    </>
                  )}
                  
                  {(invoice.retryCount || 0) >= 10 && (
                    <span className="text-xs text-red-400">
                      Max retries reached
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InvoiceHistory;