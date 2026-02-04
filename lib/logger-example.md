# Logger Usage Guide

The logger system captures all log calls and displays them in the DevConsoleTab.

## How to Use

Instead of using `console.log`, `console.warn`, `console.error`, etc., import and use the `logger` from `@/lib/logger`:

### Before:

```typescript
console.log("User logged in", userId);
console.warn("Slow network detected");
console.error("Failed to fetch data", error);
```

### After:

```typescript
import { logger } from "@/lib/logger";

logger.log("User logged in", userId);
logger.warn("Slow network detected");
logger.error("Failed to fetch data", error);
```

## Available Methods

- `logger.debug(message, ...args)` - Debug level logs
- `logger.log(message, ...args)` - Info level logs (alias: `logger.info`)
- `logger.info(message, ...args)` - Info level logs
- `logger.warn(message, ...args)` - Warning level logs
- `logger.error(message, ...args)` - Error level logs

## Features

- All logs are automatically timestamped
- Logs are stored in memory (max 1000 entries)
- Logs are displayed in the DevConsoleTab under Settings
- The original console methods are still called, so logs appear in browser console too
- Logs can be cleared from the DevConsoleTab UI

## Example

```typescript
import { logger } from "@/lib/logger";

function fetchUserData(userId: string) {
  logger.info("Fetching user data", { userId });

  try {
    // ... fetch logic
    logger.debug("User data fetched successfully", userData);
  } catch (error) {
    logger.error("Failed to fetch user data", error);
  }
}
```

## Viewing Logs

1. Open Settings (gear icon)
2. Navigate to the "Dev Console" tab
3. Select the "Console" sub-tab
4. All logged messages will appear here with timestamps
5. Use "Copy All" to copy logs for debugging
6. Use "Clear" to clear all logs
