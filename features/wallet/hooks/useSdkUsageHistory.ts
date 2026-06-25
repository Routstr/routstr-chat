"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UsageTrackingEntry } from "@routstr/sdk/storage";
import { usageTrackingDriver } from "@/sdk/sharedStore";

export interface UsageHistoryFilters {
  after?: number;
  modelId?: string;
  baseUrl?: string;
}

interface UsageTotals {
  requests: number;
  totalTokens: number;
  satsCost: number;
}

interface UsageHistoryData {
  entries: UsageTrackingEntry[];
  models: string[];
  providers: string[];
}

const USAGE_QUERY_KEY = "sdk-usage-history";

export function useSdkUsageHistory(filters: UsageHistoryFilters) {
  const queryClient = useQueryClient();

  const query = useQuery<UsageHistoryData>({
    queryKey: [USAGE_QUERY_KEY],
    queryFn: async () => {
      const entries = await usageTrackingDriver.list();

      return {
        entries,
        models: [...new Set(entries.map((entry) => entry.modelId))].sort(),
        providers: [...new Set(entries.map((entry) => entry.baseUrl))].sort(),
      };
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const filtered = useMemo(() => {
    const filteredEntries = (query.data?.entries ?? []).filter(
      (entry) =>
        (!filters.after || entry.timestamp > filters.after) &&
        (!filters.modelId || entry.modelId === filters.modelId) &&
        (!filters.baseUrl || entry.baseUrl === filters.baseUrl)
    );

    return {
      entries: filteredEntries.slice(0, 200),
      totals: filteredEntries.reduce<UsageTotals>(
        (sum, entry) => ({
          requests: sum.requests + 1,
          totalTokens: sum.totalTokens + entry.totalTokens,
          satsCost: sum.satsCost + entry.satsCost,
        }),
        {
          requests: 0,
          totalTokens: 0,
          satsCost: 0,
        }
      ),
    };
  }, [filters.after, filters.baseUrl, filters.modelId, query.data?.entries]);

  const clearUsage = async () => {
    await usageTrackingDriver.clear();
    await queryClient.invalidateQueries({ queryKey: [USAGE_QUERY_KEY] });
  };

  return {
    entries: filtered.entries,
    totals: filtered.totals,
    hasUsage: (query.data?.entries.length ?? 0) > 0,
    models: query.data?.models ?? [],
    providers: query.data?.providers ?? [],
    isLoading: query.isLoading,
    error: query.error,
    clearUsage,
  };
}
