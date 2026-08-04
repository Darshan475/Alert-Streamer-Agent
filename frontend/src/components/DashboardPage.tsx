"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertList } from "@/components/AlertList";
import { AlertDetail } from "@/components/AlertDetail";
import { StatsCards } from "@/components/StatsCards";
import { ChatModal } from "@/components/ChatModal";
import { LlmSelector } from "@/components/LlmSelector";
import { Pagination } from "@/components/Pagination";
import { StatusFilterTabs } from "@/components/StatusFilterTabs";
import { Toast } from "@/components/Toast";
import { useAlerts, useHealth, useStats } from "@/hooks/useAlerts";
import type { AlertStatus } from "@/lib/types";
import { Radio, RefreshCw } from "lucide-react";

const PAGE_SIZE = 5;

export function DashboardPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const { data: alertsData, error, mutate } = useAlerts();
  const { data: stats, mutate: mutateStats } = useStats();
  const { mutate: mutateHealth } = useHealth();

  const silentRefresh = useCallback(() => {
    void mutate();
    void mutateStats();
  }, [mutate, mutateStats]);

  const alerts = alertsData?.items ?? [];
  const filteredAlerts = useMemo(() => {
    if (statusFilter === "all") return alerts;
    return alerts.filter((a) => a.status === statusFilter);
  }, [alerts, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / PAGE_SIZE));
  const paginatedAlerts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredAlerts.slice(start, start + PAGE_SIZE);
  }, [filteredAlerts, page]);

  const selectedAlert = alerts.find((a) => a.id === selectedId) ?? null;
  const statusCounts = stats?.by_status ?? {};

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="h-screen flex flex-col bg-[#0b0f19] text-slate-200 overflow-hidden">
      <header className="shrink-0 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-cyan-500/10 p-2 shrink-0">
              <Radio className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-white truncate">Alert Streamer</h1>
              <p className="text-xs text-slate-500 truncate hidden sm:block">
                LLM investigation · Human-in-the-loop · Agentic AI Project
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <LlmSelector
              compact
              onChanged={(message) => {
                void mutateHealth();
                setToast({ message, type: "success" });
              }}
            />
            <button
              type="button"
              onClick={silentRefresh}
              className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:border-slate-500 transition-colors active:scale-95 shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-7xl mx-auto w-full px-4 py-4 flex flex-col gap-4">
        {error && (
          <div className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
            Cannot reach backend at {process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}.
            Start the FastAPI server first.
          </div>
        )}

        <StatsCards stats={stats} />

        <div className="flex-1 min-h-0 grid lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 flex flex-col min-h-0 gap-3">
            <div className="shrink-0 flex flex-col gap-2">
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                Alert Stream ({filteredAlerts.length})
              </h2>
              <StatusFilterTabs
                active={statusFilter}
                counts={{ ...statusCounts, all: alertsData?.total ?? alerts.length }}
                onChange={setStatusFilter}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <AlertList
                alerts={paginatedAlerts}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={filteredAlerts.length}
              onPageChange={setPage}
            />
          </div>

          <div className="lg:col-span-5 flex flex-col min-h-0 gap-3">
            <h2 className="shrink-0 text-sm font-medium text-slate-400 uppercase tracking-wider">
              Investigation & Human Review
            </h2>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AlertDetail
                alert={selectedAlert}
                onReviewComplete={silentRefresh}
                onToast={(message, type) => setToast({ message, type })}
              />
            </div>
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
