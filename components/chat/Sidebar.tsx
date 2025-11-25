import { ChevronDown, PlusCircle, Settings, Trash2, X, Key, SquarePen, RefreshCw } from 'lucide-react';
import { Conversation } from '@/types/chat';

interface SidebarProps {
  isAuthenticated: boolean;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  isMobile: boolean;
  conversations: Conversation[];
  activeConversationId: string | null;
  createNewConversation: () => void;
  loadConversation: (id: string) => void;
  deleteConversation: (id: string, e: React.MouseEvent) => void;
  setIsSettingsOpen: (isOpen: boolean) => void;
  setInitialSettingsTab: (tab: 'settings' | 'wallet' | 'history' | 'api-keys') => void;
  balance: number;
  syncWithNostr: () => Promise<void>;
  isSyncing: boolean;
}

export default function Sidebar({
  isAuthenticated,
  isSidebarOpen,
  setIsSidebarOpen,
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  isMobile,
  conversations,
  activeConversationId,
  createNewConversation,
  loadConversation,
  deleteConversation,
  setIsSettingsOpen,
  setInitialSettingsTab,
  balance,
  syncWithNostr,
  isSyncing
}: SidebarProps) {
  return (
    <div className="relative h-full flex-shrink-0 z-50">
      {/* Sidebar */}
      <div
        className={`${isMobile
          ? (isSidebarOpen ? 'fixed inset-0 z-50 w-72 translate-x-0' : 'fixed inset-0 z-50 w-72 -translate-x-full')
          : `fixed top-0 left-0 h-full w-72 ${isSidebarCollapsed ? '-translate-x-full opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'}`}
          bg-[#0f0f0f] flex flex-col transition-all duration-300 ease-in-out shadow-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Action Bar with New Chat button and Collapse/Close button */}
        <div className="flex items-center h-[60px] px-4 gap-2">
          {/* New Chat Button */}
          <button
            onClick={() => {
              createNewConversation();
              if (isMobile) setIsSidebarOpen(false);
            }}
            className="flex-1 min-w-0 flex items-center gap-2 text-white/90 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md py-2 px-3 h-[36px] text-sm transition-colors cursor-pointer"
            data-tutorial="new-chat-button"
          >
            <SquarePen className="h-4 w-4" />
            <span>New chat</span>
          </button>

          {/* Desktop Collapse Button (only when sidebar is not collapsed) */}
          {!isMobile && (
            <button
              onClick={() => setIsSidebarCollapsed(true)}
              className="p-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white transition-colors cursor-pointer"
              aria-label="Collapse sidebar"
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-90 text-white/70" />
            </button>
          )}

          {/* Mobile Close Button inline with New Chat */}
          {isMobile && (
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-full p-1.5 shadow-md border border-white/10 bg-white/5 hover:bg-white/10 text-white"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="text-xs text-white/50 font-medium">Chats</div>
            <button
              onClick={() => syncWithNostr()}
              disabled={isSyncing}
              className={`p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors ${isSyncing ? 'animate-spin' : ''}`}
              title="Sync with Nostr"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          {conversations.length === 0 ? (
            <p className="text-xs text-white/50 text-center py-2">No saved conversations</p>
          ) : (
            [...conversations].map(conversation => (
              <div
                key={conversation.id}
                onClick={() => {
                  loadConversation(conversation.id);
                  if (isMobile) setIsSidebarOpen(false);
                }}
                className={`p-2 rounded text-sm cursor-pointer flex justify-between items-center group ${activeConversationId === conversation.id
                  ? 'bg-white/10 text-white'
                  : 'text-white/70 hover:bg-white/5'
                  }`}
              >
                <div className="flex items-center gap-2 flex-1 truncate">
                  <span className="truncate">{conversation.title}</span>
                </div>
                <button
                  onClick={(e) => deleteConversation(conversation.id, e)}
                  className="text-white/40 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Bottom Controls */}
        <div className="p-4 mt-auto">
          <div className="flex items-center justify-between">
            {/* Settings Button - Left */}
            <button
              onClick={() => {
                setIsSettingsOpen(true);
                setInitialSettingsTab('settings');
              }}
              className="flex items-center gap-2 text-white/90 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md py-2 px-3 h-[36px] text-sm transition-colors cursor-pointer"
              data-tutorial="settings-button"
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </button>

            {/* API Keys Button - Right */}
            <button
              onClick={() => {
                setIsSettingsOpen(true);
                setInitialSettingsTab('api-keys');
              }}
              className="flex items-center gap-2 text-white/90 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md py-2 px-3 h-[36px] text-sm transition-colors cursor-pointer"
            >
              <Key className="h-4 w-4" />
              <span>API Keys</span>
            </button>
          </div>
        </div>
      </div>

      {/* Collapse/Expand Button (Desktop only) */}
      {!isMobile && isSidebarCollapsed && (
        <button
          onClick={() => setIsSidebarCollapsed(false)}
          className="fixed top-[30px] transform -translate-y-1/2 left-4 z-30 rounded-full p-1.5 shadow-md transition-all duration-300 ease-in-out border border-white/10 bg-white/5 hover:bg-white/10 text-white cursor-pointer"
          aria-label="Expand sidebar"
        >
          <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-white/70" />
        </button>
      )}
    </div>
  );
} 
