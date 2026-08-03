"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertList } from "@/components/AlertList";
import { AlertDetail } from "@/components/AlertDetail";
import { StatsCards } from "@/components/StatsCards";
import { ChatModal } from "@/components/ChatModal";
import { StatusFilterTabs } from "@/components/StatusFilterTabs";
import { Toast } from "@/components/Toast";
import { useAlerts, useHealth, useStats } from "@/hooks/useAlerts";
import type { AlertStatus } from "@/lib/types";
import { Radio, RefreshCw } from "lucide-react";

export function DashboardPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const { data: alertsData, error, mutate } = useAlerts();
  const { data: stats, mutate: mutateStats } = useStats();
  const { data: health } = useHealth();

  const silentRefresh = useCallback(() => {
    void mutate();
    void mutateStats();
  }, [mutate, mutateStats]);

  const alerts = alertsData?.items ?? [];
  const filteredAlerts = useMemo(() => {
    if (statusFilter === "all") return alerts;
    return alerts.filter((a) => a.status === statusFilter);
  }, [alerts, statusFilter]);

  const selectedAlert = alerts.find((a) => a.id === selectedId) ?? null;

  const statusCounts = stats?.by_status ?? {};

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-500/10 p-2">
              <Radio className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Alert Streamer</h1>
              <p className="text-xs text-slate-500">
                LLM investigation · Human-in-the-loop · Agentic AI Project
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={silentRefresh}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:border-slate-500 transition-colors active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6 pb-24">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
            Cannot reach backend at {process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}.
            Start the FastAPI server first.
          </div>
        )}

        <StatsCards
          stats={stats}
          llmConfigured={health?.llm_configured}
          llmProvider={health?.llm_provider}
          model={health?.model}
        />

        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                Alert Stream ({filteredAlerts.length})
              </h2>
            </div>
            <StatusFilterTabs
              active={statusFilter}
              counts={{ ...statusCounts, all: alertsData?.total ?? alerts.length }}
              onChange={setStatusFilter}
            />
            <AlertList
              alerts={filteredAlerts}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>

          <div className="lg:col-span-3 space-y-4">
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
              Investigation & Human Review
            </h2>
            <AlertDetail
              alert={selectedAlert}
              onReviewComplete={silentRefresh}
              onToast={(message, type) => setToast({ message, type })}
            />
          </div>
        </div>
      </main>

      <ChatModal selectedAlertId={selectedId} />

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
