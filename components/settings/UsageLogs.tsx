"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useSdkUsageHistory } from "@/features/wallet/hooks/useSdkUsageHistory";

type DateRange = "all" | "day" | "week" | "month";

const dateRangeMs: Record<Exclude<DateRange, "all">, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

const shortProvider = (provider: string) => {
  try {
    return new URL(provider).hostname;
  } catch {
    return provider;
  }
};

const formatSats = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 3 });

const formatFullTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString();

const formatRelativeTime = (timestamp: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
};

export default function UsageLogs() {
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [modelId, setModelId] = useState("");
  const [provider, setProvider] = useState("");

  const after = useMemo(
    () =>
      dateRange === "all" ? undefined : Date.now() - dateRangeMs[dateRange],
    [dateRange]
  );

  const {
    entries,
    totals,
    hasUsage,
    models,
    providers,
    isLoading,
    error,
    clearUsage,
  } = useSdkUsageHistory({
    after,
    modelId: modelId || undefined,
    baseUrl: provider || undefined,
  });

  const handleClear = async () => {
    if (
      window.confirm(
        "Are you sure you want to clear all local usage logs? This cannot be undone."
      )
    ) {
      await clearUsage();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-foreground/80">
              Request Usage
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Stored locally in this browser.
            </p>
          </div>
          {hasUsage && (
            <button
              type="button"
              onClick={() => void handleClear()}
              className="p-2 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
              aria-label="Clear usage logs"
              title="Clear usage logs"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select
          value={dateRange}
          onChange={(event) => setDateRange(event.target.value as DateRange)}
          className="bg-background border border-border rounded-md px-3 py-2 text-sm"
          aria-label="Filter usage by date"
        >
          <option value="all">All time</option>
          <option value="day">Last 24 hours</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
        </select>
        <select
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          className="bg-background border border-border rounded-md px-3 py-2 text-sm"
          aria-label="Filter usage by model"
        >
          <option value="">All models</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          className="bg-background border border-border rounded-md px-3 py-2 text-sm"
          aria-label="Filter usage by provider"
        >
          <option value="">All providers</option>
          {providers.map((item) => (
            <option key={item} value={item}>
              {shortProvider(item)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-muted/50 border border-border rounded-md p-3">
          <div className="text-xs text-muted-foreground">Requests</div>
          <div className="text-lg font-mono mt-1">{totals?.requests ?? 0}</div>
        </div>
        <div className="bg-muted/50 border border-border rounded-md p-3">
          <div className="text-xs text-muted-foreground">Tokens</div>
          <div className="text-lg font-mono mt-1">
            {(totals?.totalTokens ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-muted/50 border border-border rounded-md p-3">
          <div className="text-xs text-muted-foreground">Cost</div>
          <div className="text-sm sm:text-lg font-mono mt-1 whitespace-nowrap">
            {formatSats(totals?.satsCost ?? 0)} sats
          </div>
        </div>
      </div>

      <div className="bg-muted/50 border border-border rounded-md">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            Loading usage logs...
          </div>
        ) : error ? (
          <div className="p-4 text-center text-red-600 dark:text-red-400 text-sm">
            Could not load usage logs.
          </div>
        ) : entries.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No usage recorded for these filters.
          </div>
        ) : (
          <>
            {totals.requests > entries.length && (
              <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground">
                Showing latest {entries.length.toLocaleString()} of{" "}
                {totals.requests.toLocaleString()} requests
              </div>
            )}
            <div className="max-h-96 overflow-y-auto">
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left font-medium">
                        Model
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        Provider
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Tokens
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Cost
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3 min-w-0">
                          <div
                            className="max-w-56 truncate font-medium text-foreground"
                            title={entry.modelId}
                          >
                            {entry.modelId}
                          </div>
                        </td>
                        <td className="px-4 py-3 min-w-0">
                          <div
                            className="max-w-44 truncate text-muted-foreground"
                            title={entry.baseUrl}
                          >
                            {shortProvider(entry.baseUrl)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-mono text-base text-foreground">
                            {entry.totalTokens.toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            ({entry.promptTokens.toLocaleString()}/
                            {entry.completionTokens.toLocaleString()})
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                          {formatSats(entry.satsCost)} sats
                        </td>
                        <td
                          className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap"
                          title={formatFullTime(entry.timestamp)}
                        >
                          {formatRelativeTime(entry.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-border">
                {entries.map((entry) => (
                  <div key={entry.id} className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div
                          className="text-sm font-medium text-foreground truncate"
                          title={entry.modelId}
                        >
                          {entry.modelId}
                        </div>
                        <div
                          className="text-xs text-muted-foreground truncate"
                          title={entry.baseUrl}
                        >
                          {shortProvider(entry.baseUrl)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono">
                          {formatSats(entry.satsCost)} sats
                        </div>
                        <div
                          className="text-xs text-muted-foreground"
                          title={formatFullTime(entry.timestamp)}
                        >
                          {formatRelativeTime(entry.timestamp)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 rounded-md bg-background/70 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        Tokens ({entry.promptTokens.toLocaleString()}/
                        {entry.completionTokens.toLocaleString()})
                      </span>
                      <span className="font-mono text-lg text-foreground">
                        {entry.totalTokens.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
