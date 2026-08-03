"use client";

import useSWR from "swr";
import { getAlerts, getStats, getHealth } from "@/lib/api";
import type { AlertListResponse, PipelineStats } from "@/lib/types";

const fetcherAlerts = () => getAlerts({ limit: 100 });
const fetcherStats = () => getStats();
const fetcherHealth = () => getHealth();

export function useAlerts(refreshInterval = 3000) {
  return useSWR<AlertListResponse>("alerts", fetcherAlerts, {
    refreshInterval,
    revalidateOnFocus: true,
    dedupingInterval: 2000,
    keepPreviousData: true,
  });
}

export function useStats(refreshInterval = 5000) {
  return useSWR<PipelineStats>("stats", fetcherStats, {
    refreshInterval,
    dedupingInterval: 3000,
    keepPreviousData: true,
  });
}

export function useHealth() {
  return useSWR("health", fetcherHealth, { refreshInterval: 30000 });
}
