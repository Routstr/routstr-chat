/**
 * Logger utility that captures console.log calls and stores them for display in DevConsoleTab
 *
 * This module intercepts global console methods to automatically capture all logs
 * without requiring changes to existing code.
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  args: unknown[];
}

// Store for log entries
let logEntries: LogEntry[] = [];
let listeners: Set<() => void> = new Set();
let isIntercepting = false;

const MAX_LOG_ENTRIES = 1000;

// Format a log entry as a string
const formatLogEntry = (entry: LogEntry): string => {
  const timestamp = entry.timestamp
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const argsStr =
    entry.args.length > 0
      ? " " +
        entry.args
          .map((arg) => {
            try {
              if (typeof arg === "object") {
                return JSON.stringify(arg);
              }
              return String(arg);
            } catch {
              return "[Unserializable]";
            }
          })
          .join(" ")
      : "";
  return `[${timestamp}] ${entry.level}: ${entry.message}${argsStr}`;
};

// Add a log entry
const addLogEntry = (level: LogLevel, message: string, args: unknown[]) => {
  const entry: LogEntry = {
    timestamp: new Date(),
    level,
    message,
    args,
  };

  logEntries.push(entry);

  // Trim old entries if we exceed max
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
  }

  // Notify listeners
  listeners.forEach((listener) => listener());
};

// Original console methods - store before any interception
const originalConsole = {
  log: console.log.bind(console),
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

/**
 * Helper to convert any arguments to a message string
 */
const argsToMessage = (
  args: unknown[]
): { message: string; rest: unknown[] } => {
  if (args.length === 0) {
    return { message: "", rest: [] };
  }

  const first = args[0];
  if (typeof first === "string") {
    return { message: first, rest: args.slice(1) };
  }

  // If first arg is not a string, convert it
  try {
    if (typeof first === "object") {
      return { message: JSON.stringify(first), rest: args.slice(1) };
    }
    return { message: String(first), rest: args.slice(1) };
  } catch {
    return { message: "[Object]", rest: args.slice(1) };
  }
};

/**
 * Intercept global console methods to capture all logs automatically
 * This should be called once at app initialization
 */
export const interceptConsole = () => {
  if (isIntercepting) return;
  isIntercepting = true;

  // Override console.log
  console.log = (...args: unknown[]) => {
    const { message, rest } = argsToMessage(args);
    addLogEntry("INFO", message, rest);
    originalConsole.log(...args);
  };

  // Override console.debug
  console.debug = (...args: unknown[]) => {
    const { message, rest } = argsToMessage(args);
    addLogEntry("DEBUG", message, rest);
    originalConsole.debug(...args);
  };

  // Override console.info
  console.info = (...args: unknown[]) => {
    const { message, rest } = argsToMessage(args);
    addLogEntry("INFO", message, rest);
    originalConsole.info(...args);
  };

  // Override console.warn
  console.warn = (...args: unknown[]) => {
    const { message, rest } = argsToMessage(args);
    addLogEntry("WARN", message, rest);
    originalConsole.warn(...args);
  };

  // Override console.error
  console.error = (...args: unknown[]) => {
    const { message, rest } = argsToMessage(args);
    addLogEntry("ERROR", message, rest);
    originalConsole.error(...args);
  };
};

/**
 * Restore original console methods (useful for testing)
 */
export const restoreConsole = () => {
  if (!isIntercepting) return;
  isIntercepting = false;

  console.log = originalConsole.log;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
};

/**
 * Logger object with methods for each log level
 * Also calls the original console method
 * Use this for explicit logging that should always be captured
 */
export const logger = {
  debug: (message: string, ...args: unknown[]) => {
    addLogEntry("DEBUG", message, args);
    originalConsole.debug(message, ...args);
  },
  log: (message: string, ...args: unknown[]) => {
    addLogEntry("INFO", message, args);
    originalConsole.log(message, ...args);
  },
  info: (message: string, ...args: unknown[]) => {
    addLogEntry("INFO", message, args);
    originalConsole.info(message, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    addLogEntry("WARN", message, args);
    originalConsole.warn(message, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    addLogEntry("ERROR", message, args);
    originalConsole.error(message, ...args);
  },
};

/**
 * Get all log entries as formatted strings
 */
export const getLogs = (): string[] => {
  return logEntries.map(formatLogEntry);
};

/**
 * Get raw log entries
 */
export const getLogEntries = (): LogEntry[] => {
  return [...logEntries];
};

/**
 * Clear all log entries
 */
export const clearLogs = () => {
  logEntries = [];
  listeners.forEach((listener) => listener());
};

/**
 * Subscribe to log changes
 * Returns an unsubscribe function
 */
export const subscribeLogs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Get the count of log entries
 */
export const getLogCount = (): number => {
  return logEntries.length;
};

/**
 * Check if console interception is active
 */
export const isConsoleIntercepted = (): boolean => {
  return isIntercepting;
};

// Auto-intercept console on module load in browser environment
if (typeof window !== "undefined") {
  interceptConsole();
}
