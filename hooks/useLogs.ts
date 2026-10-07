"use client";

import { useSyncExternalStore } from "react";
import { clearLogs, getLogs, subscribeLogs } from "@/lib/logger";

// the log as text lines, made again only after the log changed
let lines: string[] | null = null;
const read = () => (lines ??= getLogs());
const subscribe = (onChange: () => void) => {
  // lines logged while nothing was watching are read again
  lines = null;
  return subscribeLogs(() => {
    lines = null;
    onChange();
  });
};
const NONE: string[] = [];

/** The app's log, kept up to date as lines are added. */
export const useLogs = () => {
  const logs = useSyncExternalStore(subscribe, read, () => NONE);
  return { logs, logCount: logs.length, clearLogs };
};
