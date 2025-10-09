import { useState, useEffect, useRef, useCallback } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { hasSeenTutorial, markTutorialAsSeen, loadSidebarOpen, saveSidebarOpen, loadSidebarCollapsed, saveSidebarCollapsed } from '@/utils/storageUtils';

export interface UseUiStateReturn {
  isSettingsOpen: boolean;
  isLoginModalOpen: boolean;
  isTutorialOpen: boolean;
  isModelDrawerOpen: boolean;
  isSidebarCollapsed: boolean;
  isSidebarOpen: boolean;
  textareaHeight: number;
  initialSettingsTab: 'settings' | 'wallet' | 'history' | 'api-keys' | 'models';
  isMobile: boolean;
  modelDrawerRef: React.RefObject<HTMLDivElement | null>;
  setIsSettingsOpen: (open: boolean) => void;
  setIsLoginModalOpen: (open: boolean) => void;
  setIsTutorialOpen: (open: boolean) => void;
  setIsModelDrawerOpen: (open: boolean) => void;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setTextareaHeight: (height: number) => void;
  setInitialSettingsTab: (tab: 'settings' | 'wallet' | 'history' | 'api-keys' | 'models') => void;
  handleTutorialComplete: () => void;
  handleTutorialClose: () => void;
}

/**
 * Custom hook for managing UI state and interactions
 * Handles modal and drawer states, sidebar state management,
 * mobile responsiveness, and tutorial state
 */
export const useUiState = (isAuthenticated: boolean): UseUiStateReturn => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isModelDrawerOpen, setIsModelDrawerOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => loadSidebarCollapsed());
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => loadSidebarOpen());
  const [textareaHeight, setTextareaHeight] = useState(48);
  const [initialSettingsTab, setInitialSettingsTab] = useState<'settings' | 'wallet' | 'history' | 'api-keys' | 'models'>('settings');

  const modelDrawerRef = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Handle authentication state changes
  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
    } else {
      setIsLoginModalOpen(false);
    }
  }, [isAuthenticated]);

  // Check for first visit and show tutorial
  useEffect(() => {
    if (isAuthenticated && !isMobile) {
      if (!hasSeenTutorial()) {
        setTimeout(() => {
          setIsTutorialOpen(true);
        }, 1000);
      }
    }
  }, [isAuthenticated, isMobile]);

  // Close model drawer when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isModelDrawerOpen && modelDrawerRef.current &&
        !modelDrawerRef.current.contains(event.target as Node)) {
        setIsModelDrawerOpen(false);
      }
    };

    if (isModelDrawerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDrawerOpen]);

  // Persist sidebar open state to localStorage
  useEffect(() => {
    saveSidebarOpen(isSidebarOpen);
  }, [isSidebarOpen]);

  // Persist sidebar collapsed state to localStorage
  useEffect(() => {
    saveSidebarCollapsed(isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  // iOS Safari viewport height stabilization
  useEffect(() => {
    if (typeof window !== 'undefined' && isMobile) {
      const timerId = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 500);

      return () => clearTimeout(timerId);
    }
  }, [isMobile]);

  const handleTutorialComplete = useCallback(() => {
    markTutorialAsSeen();
  }, []);

  const handleTutorialClose = useCallback(() => {
    setIsTutorialOpen(false);
  }, []);

  return {
    isSettingsOpen,
    isLoginModalOpen,
    isTutorialOpen,
    isModelDrawerOpen,
    isSidebarCollapsed,
    isSidebarOpen,
    textareaHeight,
    initialSettingsTab, 
    isMobile,
    modelDrawerRef,
    setIsSettingsOpen,
    setIsLoginModalOpen,
    setIsTutorialOpen,
    setIsModelDrawerOpen,
    setIsSidebarCollapsed,
    setIsSidebarOpen,
    setTextareaHeight,
    setInitialSettingsTab,
    handleTutorialComplete,
    handleTutorialClose
  };
};