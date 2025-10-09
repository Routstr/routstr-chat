import React from 'react';
import NostrRelayManager from './settings/NostrRelayManager';

interface QueryTimeoutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QueryTimeoutModal: React.FC<QueryTimeoutModalProps> = ({ isOpen, onClose }) => {
  const handleRefresh = () => {
    try { localStorage.setItem('cashu_relays_timeout', 'false'); } catch {}
    window.location.reload();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-white/10 rounded-xl max-w-sm w-full p-5 relative">
        <h2 className='text-xl font-semibold text-center text-white mb-4'>Connection Timeout</h2>
        <p className="text-sm text-gray-400 mb-4 text-center">
          It looks like there was a problem connecting to the relays. Please add/remove relays and refresh the page to try again.
        </p>
        <NostrRelayManager/>
        <div className="flex justify-center">
          <button
            onClick={handleRefresh}
            className="w-full py-2 bg-white text-black rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  );
};