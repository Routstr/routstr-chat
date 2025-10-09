'use client';

import React, { useState, useCallback } from 'react';
import { Download, Upload, RefreshCw, Info, Clock, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useConversationState } from '@/hooks/useConversationState';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const ConversationSyncTab = () => {
  const { user } = useCurrentUser();
  const {
    conversations,
    isLoadingConversations,
    isSyncingConversations,
    cloudSyncEnabled,
    setCloudSyncEnabled,
    refetchConversations,
    syncConflicts
  } = useConversationState();

  const [showTooltip, setShowTooltip] = useState(false);
  const [retentionDays, setRetentionDays] = useState(90);

  const handleExportConversations = useCallback(() => {
    try {
      const exportData = {
        conversations,
        exportDate: new Date().toISOString(),
        version: '1.0.0'
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversations-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Conversations exported successfully!');
    } catch (error) {
      toast.error('Failed to export conversations');
    }
  }, [conversations]);

  const handleImportConversations = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.conversations && Array.isArray(data.conversations)) {
          toast.success(`Found ${data.conversations.length} conversations to import`);
        } else {
          toast.error('Invalid conversation export format');
        }
      } catch (error) {
        toast.error('Failed to parse conversation file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, []);

  const handleManualSync = useCallback(() => {
    if (refetchConversations) {
      refetchConversations();
      toast.success('Manual sync triggered');
    }
  }, [refetchConversations]);

  if (!user) {
    return (
      <div className="space-y-4 text-white">
        <h3 className="text-lg font-semibold">Conversation Sync</h3>
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <p className="text-yellow-400 text-sm">
            Please log in to access conversation sync features.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-white">
      <h3 className="text-lg font-semibold">Conversation Sync</h3>

      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">Sync with Cloud (Nostr)</span>
          <div
            className="relative inline-block"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <Info className="h-4 w-4 text-white/60 hover:text-white transition-colors cursor-pointer" />
            <div
              className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 p-3 bg-gray-800 text-white text-xs rounded-md shadow-lg transition-opacity duration-300 w-64 border border-gray-700 whitespace-normal z-50 ${
                showTooltip ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
              }`}
            >
              <p>Conversations are synced with Nostr using <span className="font-semibold">NIP-78</span> (Kind 30078) for addressable replaceable events.</p>
              <p className="mt-1">Data is encrypted using <span className="font-semibold">NIP-44</span> for enhanced security and privacy.</p>
            </div>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={cloudSyncEnabled}
          onClick={() => setCloudSyncEnabled && setCloudSyncEnabled(!cloudSyncEnabled)}
          className={`${
            cloudSyncEnabled ? 'bg-white' : 'bg-white/20'
          } inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer`}
        >
          <span
            className={`${
              cloudSyncEnabled ? 'translate-x-[calc(100%-2px)] bg-black' : 'translate-x-0 bg-white'
            } pointer-events-none block size-4 rounded-full ring-0 transition-transform`}
          />
        </button>
      </div>

      {(isLoadingConversations || isSyncingConversations) && (
        <div className="mb-4 flex items-center text-white/70">
          <svg className="animate-spin h-5 w-5 mr-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {isLoadingConversations ? 'Loading conversations...' : 'Syncing conversations...'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="h-5 w-5 text-blue-400" />
            <span className="text-sm font-medium text-white">Conversations</span>
          </div>
          <p className="text-lg font-semibold text-white">{conversations.length}</p>
          <p className="text-xs text-white/50">Total stored</p>
        </div>

        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-5 w-5 text-green-400" />
            <span className="text-sm font-medium text-white">Sync Status</span>
          </div>
          <p className="text-sm text-white">
            {cloudSyncEnabled ? 'Enabled' : 'Disabled'}
          </p>
          <p className="text-xs text-white/50">
            {cloudSyncEnabled ? 'Auto-sync every 2 minutes' : 'Local storage only'}
          </p>
        </div>
      </div>

      {syncConflicts && syncConflicts.length > 0 && (
        <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <h4 className="text-orange-400 font-medium mb-2">Sync Conflicts Detected</h4>
          <p className="text-orange-400/80 text-sm mb-3">
            {syncConflicts.length} conversation{syncConflicts.length > 1 ? 's' : ''} ha{syncConflicts.length > 1 ? 've' : 's'} conflicting versions.
          </p>
          <div className="space-y-2">
            {syncConflicts.slice(0, 3).map((conflict) => (
              <div key={conflict.conversationId} className="text-xs text-orange-400/60">
                • {conflict.localVersion.title} ({conflict.conflictType} conflict)
              </div>
            ))}
            {syncConflicts.length > 3 && (
              <div className="text-xs text-orange-400/60">
                • And {syncConflicts.length - 3} more...
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-white/70">Actions</h4>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Manual Sync</p>
            <p className="text-xs text-white/50">Force sync conversations now</p>
          </div>
          <button
            onClick={handleManualSync}
            disabled={!cloudSyncEnabled || isSyncingConversations}
            className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-md text-sm hover:bg-green-500/20 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncingConversations ? 'animate-spin' : ''}`} />
            {isSyncingConversations ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Export Conversations</p>
            <p className="text-xs text-white/50">Download all conversations as JSON</p>
          </div>
          <button
            onClick={handleExportConversations}
            disabled={conversations.length === 0}
            className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-md text-sm hover:bg-blue-500/20 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Import Conversations</p>
            <p className="text-xs text-white/50">Upload conversations from JSON file</p>
          </div>
          <label className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border border-purple-500/30 text-purple-400 rounded-md text-sm hover:bg-purple-500/20 transition-colors cursor-pointer">
            <Upload className="h-4 w-4" />
            Import
            <input
              type="file"
              accept=".json"
              onChange={handleImportConversations}
              className="hidden"
            />
          </label>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-white/70">Settings</h4>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Data Retention</p>
            <p className="text-xs text-white/50">Auto-delete conversations older than</p>
          </div>
          <select
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20"
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
            <option value={-1}>Never</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default ConversationSyncTab;