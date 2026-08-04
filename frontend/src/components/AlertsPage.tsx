"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertList } from "@/components/AlertList";
import { AlertDetail } from "@/components/AlertDetail";
import { AppShell } from "@/components/AppShell";
import { StatsCards } from "@/components/StatsCards";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { Pagination } from "@/components/Pagination";
import { StatusFilterTabs } from "@/components/StatusFilterTabs";
import { Toast } from "@/components/Toast";
import { useAlerts, useHealth, useStats } from "@/hooks/useAlerts";
import { computeFilterCounts, filterAlerts, type FilterId } from "@/lib/alertFilters";
import { ExternalLink } from "lucide-react";

const PAGE_SIZE = 5;

export function AlertsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterId>("all");
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const { data: alertsData, error, mutate, isLoading, isValidating } = useAlerts();
  const { data: stats, mutate: mutateStats, isLoading: statsLoading } = useStats();
  const { mutate: mutateHealth } = useHealth();

  const silentRefresh = useCallback(() => {
    void mutate();
    void mutateStats();
  }, [mutate, mutateStats]);

  const alerts = alertsData?.items ?? [];
  const filterCounts = useMemo(() => computeFilterCounts(alerts), [alerts]);
  const filteredAlerts = useMemo(
    () => filterAlerts(alerts, statusFilter),
    [alerts, statusFilter]
  );

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / PAGE_SIZE));
  const paginatedAlerts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredAlerts.slice(start, start + PAGE_SIZE);
  }, [filteredAlerts, page]);

  const selectedAlert = alerts.find((a) => a.id === selectedId) ?? null;
  const showLoader = (isLoading && !alertsData) || (isValidating && !alerts.length);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <AppShell
      subtitle="Validate and Review Trigger Events"
      live
      chatAlertId={selectedId}
      onRefresh={silentRefresh}
      onLlmChanged={(message) => {
        void mutateHealth();
        setToast({ message, type: "success" });
      }}
    >
      <div className="relative h-full max-w-7xl mx-auto w-full px-4 py-4 flex flex-col gap-4">
        <LoadingOverlay show={showLoader || statsLoading} label="Syncing alert stream…" />

        {error && (
          <div className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
            Cannot reach backend at {process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}.
            Start the FastAPI server first.
          </div>
        )}

        <StatsCards stats={stats} alertCount={filterCounts.all} />

        <div className="flex-1 min-h-0 grid lg:grid-cols-12 lg:grid-rows-[auto_auto_1fr_auto] gap-x-4 gap-y-2">
          <h2 className="lg:col-span-7 lg:row-start-1 text-sm font-medium text-slate-400 uppercase tracking-wider self-end leading-none pb-0.5">
            Alert Stream ({filteredAlerts.length})
          </h2>
          <h2 className="lg:col-span-5 lg:row-start-1 text-sm font-medium text-slate-400 uppercase tracking-wider self-end leading-none pb-0.5">
            Investigation & Human Review
          </h2>

          <div className="lg:col-span-7 lg:row-start-2 min-h-[2.25rem] flex items-end">
            <StatusFilterTabs
              active={statusFilter}
              counts={filterCounts}
              onChange={setStatusFilter}
            />
          </div>
          <div className="hidden lg:block lg:col-span-5 lg:row-start-2 min-h-[2.25rem]" aria-hidden />

          <div className="lg:col-span-7 lg:row-start-3 min-h-0 overflow-y-auto pr-1 scroll-panel">
            <AlertList
              alerts={paginatedAlerts}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
          <div className="lg:col-span-5 lg:row-start-3 min-h-0 overflow-y-auto scroll-panel">
            <AlertDetail
              alert={selectedAlert}
              onReviewComplete={silentRefresh}
              onToast={(message, type) => setToast({ message, type })}
            />
          </div>

          <div className="lg:col-span-7 lg:row-start-4">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={filteredAlerts.length}
              onPageChange={setPage}
            />
          </div>
          <div className="hidden lg:flex lg:col-span-5 lg:row-start-4 items-center justify-end">
            <Link
              href="/trigger"
              className="flex items-center gap-1.5 text-xs text-cyan-400/80 hover:text-cyan-300 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Trigger more events
            </Link>
          </div>
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </AppShell>
  );
}
