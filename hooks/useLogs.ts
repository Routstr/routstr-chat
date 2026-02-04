"use client";

import { useState, useEffect, useCallback } from "react";
import { getLogs, clearLogs, subscribeLogs, getLogCount } from "@/lib/logger";

/**
 * Hook to access and manage application logs
 * Automatically updates when new logs are added
 */
export const useLogs = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [logCount, setLogCount] = useState(0);

  useEffect(() => {
    // Initial load
    setLogs(getLogs());
    setLogCount(getLogCount());

    // Subscribe to changes
    const unsubscribe = subscribeLogs(() => {
      setLogs(getLogs());
      setLogCount(getLogCount());
    });

    return unsubscribe;
  }, []);

  const handleClearLogs = useCallback(() => {
    clearLogs();
  }, []);

  return {
    logs,
    logCount,
    clearLogs: handleClearLogs,
  };
};
