import { ChevronDown, MessageSquare, PlusCircle, Settings, Trash2, X, Key, SquarePen } from 'lucide-react';
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
  balance
}: SidebarProps) {
  return (
    <div className="relative h-full flex-shrink-0 z-50">
      {/* Sidebar */}
      <div
        className={`${isMobile ?
          (isSidebarOpen ? 'fixed inset-0 z-50 w-72 translate-x-0' : 'fixed inset-0 z-50 w-72 -translate-x-full') :
          isSidebarCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-72'} 
          bg-zinc-900/95 flex flex-col h-full transition-all duration-300 ease-in-out shadow-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Close Button */}
        {isMobile && (
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="absolute top-4 right-4 p-1 text-white/70 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        {/* Top Action Bar with New Chat button and Collapse button */}
        <div className="flex items-center h-[60px] px-4">
          {/* Desktop Collapse Button (only when sidebar is not collapsed) */}
          {!isMobile && (
            <button
              onClick={() => setIsSidebarCollapsed(true)}
              className="p-1.5 mr-2 rounded-full bg-black border border-white/10 hover:bg-white/5 transition-colors cursor-pointer"
              aria-label="Collapse sidebar"
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-90 text-white/70" />
            </button>
          )}

          {/* New Chat Button */}
          <button
            onClick={() => {
              createNewConversation();
              if (isMobile) setIsSidebarOpen(false);
            }}
            className="w-full flex items-center gap-2 text-white bg-white/5 hover:bg-white/10 rounded-md py-2 px-3 h-[36px] text-sm transition-colors cursor-pointer"
            data-tutorial="new-chat-button"
          >
            <SquarePen className="h-4 w-4 text-white" />
            <span>New chat</span>
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          <div className="text-xs uppercase text-white/50 font-medium px-2 pb-2">RECENT CHATS</div>
          {conversations.length === 0 ? (
            <p className="text-xs text-white/50 text-center py-2">No saved conversations</p>
          ) : (
            [...conversations].reverse().map(conversation => (
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
                  <MessageSquare className="h-4 w-4 flex-shrink-0 opacity-70" />
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
              className="flex items-center gap-2 text-white bg-white/5 hover:bg-white/10 rounded-md py-2 px-3 h-[36px] text-sm transition-colors cursor-pointer"
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
              className="flex items-center gap-2 text-white bg-white/5 hover:bg-white/10 rounded-md py-2 px-3 h-[36px] text-sm transition-colors cursor-pointer"
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
          className="fixed top-[30px] transform -translate-y-1/2 left-4 z-30 bg-black rounded-full p-1.5 shadow-md transition-all duration-300 ease-in-out border border-white/10 hover:bg-white/5 cursor-pointer"
          aria-label="Expand sidebar"
        >
          <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-white/70" />
        </button>
      )}
    </div>
  );
} 