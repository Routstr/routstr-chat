import { createSdkStore, createSqliteDriver } from "@routstr/sdk/storage";

interface ClientIdEntry {
  clientId: string;
  name: string;
  apiKey: string;
  createdAt?: number;
  lastUsed?: number | null;
}

interface SetClientIdsOptions {
  /** List of clientIds to set. If null, removes all clientIds. */
  clientIds: ClientIdEntry[] | null;
  /** Mode: 'set' replaces all, 'add' adds to existing, 'remove' removes by clientId */
  mode?: "set" | "add" | "remove";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: npx tsx scripts/set-client-ids.ts [options]

Options:
  --set              Replace all existing clientIds with provided ones
  --add              Add provided clientIds to existing ones (updates if clientId exists)
  --remove           Remove clientIds by clientId
  --list             List all current clientIds
  --clear            Remove all clientIds
  
  --client-id <id>   Client ID (required for --add and --set)
  --name <name>      Client name (required for --add and --set)
  --api-key <key>    API key (required for --add and --set)

Examples:
  # List current clientIds
  npx tsx scripts/set-client-ids.ts --list

  # Add a new clientId
  npx tsx scripts/set-client-ids.ts --add --client-id "my-client-123" --name "My App" --api-key "sk-xxx"

  # Replace all clientIds
  npx tsx scripts/set-client-ids.ts --set --client-id "my-client-123" --name "My App" --api-key "sk-xxx"

  # Remove all clientIds
  npx tsx scripts/set-client-ids.ts --clear
`);
    process.exit(0);
  }

  const { store, hydrate } = createSdkStore({ driver: createSqliteDriver() });
  await hydrate;

  const mode = args.includes("--set")
    ? "set"
    : args.includes("--add")
      ? "add"
      : args.includes("--remove")
        ? "remove"
        : args.includes("--clear")
          ? "clear"
          : null;

  const getArg = (flag: string): string | null => {
    const index = args.indexOf(flag);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
  };

  if (args.includes("--list")) {
    const currentClientIds = store.getState().clientIds;
    console.log("\n=== Current ClientIds ===\n");
    if (currentClientIds.length === 0) {
      console.log("  No clientIds stored.\n");
    } else {
      for (const entry of currentClientIds) {
        console.log(`  Client ID: ${entry.clientId}`);
        console.log(`  Name:      ${entry.name}`);
        console.log(`  API Key:   ${entry.apiKey.substring(0, 10)}...`);
        console.log(
          `  Created:   ${entry.createdAt ? new Date(entry.createdAt).toISOString() : "N/A"}`
        );
        console.log(
          `  Last Used: ${entry.lastUsed ? new Date(entry.lastUsed).toISOString() : "Never"}`
        );
        console.log("");
      }
      console.log(`Total: ${currentClientIds.length} clientId(s)\n`);
    }
    return;
  }

  if (mode === "clear") {
    store.getState().setClientIds([]);
    console.log("All clientIds have been removed.\n");
    return;
  }

  if (!mode) {
    console.error("Error: No operation specified. Use --help for usage information.");
    process.exit(1);
  }

  const clientId = getArg("--client-id");
  const name = getArg("--name");
  const apiKey = getArg("--api-key");

  if (mode !== "remove" && (!clientId || !name || !apiKey)) {
    console.error("Error: --client-id, --name, and --api-key are required for this operation.");
    process.exit(1);
  }

  const currentClientIds = store.getState().clientIds;

  if (mode === "set") {
    const newEntry: ClientIdEntry = {
      clientId: clientId as string,
      name: name as string,
      apiKey: apiKey as string,
      createdAt: Date.now(),
      lastUsed: null,
    };
    store.getState().setClientIds([newEntry]);
    console.log(`ClientId "${clientId}" has been set.\n`);
  } else if (mode === "add") {
    const existingIndex = currentClientIds.findIndex(
      (e) => e.clientId === clientId
    );
    let updated: ClientIdEntry[];

    if (existingIndex !== -1) {
      // Update existing - TypeScript knows name and apiKey are not null due to earlier check
      updated = currentClientIds.map((e, i) =>
        i === existingIndex
          ? { ...e, name: name as string, apiKey: apiKey as string, lastUsed: Date.now() }
          : e
      );
      console.log(`ClientId "${clientId}" has been updated.\n`);
    } else {
      // Add new - TypeScript knows name and apiKey are not null due to earlier check
      const newEntry: ClientIdEntry = {
        clientId: clientId as string,
        name: name as string,
        apiKey: apiKey as string,
        createdAt: Date.now(),
        lastUsed: null,
      };
      updated = [...currentClientIds, newEntry];
      console.log(`ClientId "${clientId}" has been added.\n`);
    }
    store.getState().setClientIds(updated);
  } else if (mode === "remove") {
    if (!clientId) {
      console.error("Error: --client-id is required for --remove.");
      process.exit(1);
    }
    const updated = currentClientIds.filter((e) => e.clientId !== clientId);
    if (updated.length === currentClientIds.length) {
      console.log(`ClientId "${clientId}" not found.\n`);
    } else {
      store.getState().setClientIds(updated);
      console.log(`ClientId "${clientId}" has been removed.\n`);
    }
  }
}

main().catch((error) => {
  console.error("Failed to set clientIds:", error);
  process.exit(1);
});
