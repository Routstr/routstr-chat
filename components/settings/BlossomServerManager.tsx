import React, { useState } from "react";
import { Plus, XCircle, RotateCcw, HardDrive } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useBlossomSync } from "@/hooks/useBlossomSync";
import { DEFAULT_BLOSSOM_SERVERS } from "@/lib/blossom";

const BlossomServerManager: React.FC = () => {
  const {
    blossomSyncEnabled,
    setBlossomSyncEnabled,
    blossomServers,
    setBlossomServers,
  } = useBlossomSync();
  const [newServerInput, setNewServerInput] = useState<string>("");

  const handleAddServer = () => {
    const trimmedServer = newServerInput.trim();
    if (trimmedServer && !blossomServers.includes(trimmedServer)) {
      // Validate URL format
      try {
        const url = new URL(trimmedServer);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          alert("Please enter a valid HTTP or HTTPS URL");
          return;
        }
        setBlossomServers([...blossomServers, trimmedServer]);
        setNewServerInput("");
      } catch {
        alert("Please enter a valid URL");
      }
    }
  };

  const handleRemoveServer = (serverToRemove: string) => {
    setBlossomServers(
      blossomServers.filter((server) => server !== serverToRemove)
    );
  };

  const handleResetToDefaults = () => {
    if (window.confirm("Reset Blossom servers to defaults?")) {
      setBlossomServers(DEFAULT_BLOSSOM_SERVERS);
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground/80">
          Blossom Storage
        </h3>
        <button
          onClick={handleResetToDefaults}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 text-foreground rounded-md transition-colors"
          type="button"
          title="Reset to default servers"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>
      <div className="bg-muted/50 border border-border rounded-md p-4">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-foreground/70">
              Enable Blossom Sync
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Upload and sync files via Blossom servers
            </div>
          </div>
          <Switch
            checked={blossomSyncEnabled}
            onCheckedChange={setBlossomSyncEnabled}
          />
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-sm text-foreground mb-3">
            Manage your Blossom file storage servers
          </p>
          <div className="max-h-48 overflow-y-auto space-y-2 mb-4">
            {blossomServers.length > 0 ? (
              blossomServers.map((server) => (
                <div
                  className="flex items-center justify-between bg-muted/50 rounded-md p-2"
                  key={server}
                >
                  <div className="flex items-center gap-2 grow min-w-0">
                    <HardDrive className="h-4 w-4 text-blue-400 shrink-0" />
                    <span className="text-sm text-foreground truncate">
                      {server}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveServer(server)}
                    className="text-red-400 hover:text-red-500 transition-colors ml-2 shrink-0"
                    type="button"
                    title="Remove server"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No Blossom servers configured. Add a server to enable file sync.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="grow bg-muted/50 border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none"
              placeholder="Add Blossom server URL (e.g., https://blossom.example.com)"
              value={newServerInput}
              onChange={(e) => setNewServerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAddServer();
                }
              }}
            />
            <button
              onClick={handleAddServer}
              className="bg-muted hover:bg-muted/80 text-foreground px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-1"
              type="button"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlossomServerManager;
