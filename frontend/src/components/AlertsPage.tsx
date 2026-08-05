"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertList } from "@/components/AlertList";
import { AlertDetailFullscreenModal } from "@/components/AlertDetailFullscreenModal";
import { AppShell } from "@/components/AppShell";
import { StatsCards } from "@/components/StatsCards";
import { Pagination } from "@/components/Pagination";
import { StatusFilterTabs } from "@/components/StatusFilterTabs";
import { Toast } from "@/components/Toast";
import { useAlertStream } from "@/hooks/useAlertStream";
import { useHealth } from "@/hooks/useAlerts";
import { computeFilterCounts, filterAlerts, searchAlerts, type FilterId } from "@/lib/alertFilters";
import { ExternalLink, Loader2, Search, Trash2 } from "lucide-react";

const PAGE_SIZE = 8;

export function AlertsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterId>("all");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const { alerts, stats, connected, error, isLoading, reconnect, clearAll } = useAlertStream();
  const { mutate: mutateHealth } = useHealth();

  const silentRefresh = useCallback(() => {
    reconnect();
  }, [reconnect]);

  const filterCounts = useMemo(() => computeFilterCounts(alerts), [alerts]);
  const filteredAlerts = useMemo(
    () => filterAlerts(alerts, statusFilter),
    [alerts, statusFilter]
  );
  const searchedAlerts = useMemo(
    () => searchAlerts(filteredAlerts, searchQuery),
    [filteredAlerts, searchQuery]
  );

  const totalPages = Math.max(1, Math.ceil(searchedAlerts.length / PAGE_SIZE));
  const paginatedAlerts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return searchedAlerts.slice(start, start + PAGE_SIZE);
  }, [searchedAlerts, page]);

  const selectedAlert = useMemo(
    () => alerts.find((a) => a.id === selectedId) ?? null,
    [alerts, selectedId]
  );

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleClearPipeline = useCallback(async () => {
    if (clearing) return;
    if (!window.confirm("Clear all alerts from the pipeline store?")) return;
    setClearing(true);
    try {
      await clearAll();
      setSelectedId(null);
      setToast({ message: "Pipeline cleared.", type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : "Failed to clear pipeline",
        type: "error",
      });
    } finally {
      setClearing(false);
    }
  }, [clearAll, clearing]);

  return (
    <AppShell
      subtitle="Agent Pipeline — Ingest · Validate · Dedup · Prioritize"
      live={connected}
      onRefresh={silentRefresh}
      onLlmChanged={(message) => {
        void mutateHealth();
        setToast({ message, type: "success" });
      }}
    >
      <div className="relative h-full max-w-5xl mx-auto w-full px-4 py-4 flex flex-col gap-3">
        {isLoading && (
          <div className="shrink-0 flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
            Loading alerts…
          </div>
        )}

        {error && !isLoading && (
          <div className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-amber-200 text-xs">
            Stream reconnecting — showing cached data.
          </div>
        )}

        <StatsCards stats={stats} alertCount={filterCounts.all} />

        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider shrink-0">
              Alert Stream ({searchedAlerts.length})
            </h2>
            <StatusFilterTabs
              active={statusFilter}
              counts={filterCounts}
              onChange={setStatusFilter}
            />
            <div className="relative min-w-[140px] max-w-[200px] flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search alerts…"
                className="w-full rounded-lg border border-slate-700 bg-slate-900/80 py-1.5 pl-8 pr-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleClearPipeline()}
              disabled={clearing || alerts.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-40 shrink-0"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
            <Link
              href="/trigger"
              className="ml-auto flex items-center gap-1.5 text-xs text-cyan-400/80 hover:text-cyan-300 transition-colors shrink-0"
            >
              <ExternalLink className="h-3 w-3" />
              Trigger events
            </Link>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 scroll-panel">
            <AlertList
              alerts={paginatedAlerts}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>

          <div className="shrink-0">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={searchedAlerts.length}
              onPageChange={setPage}
            />
          </div>
        </div>
      </div>

      {selectedAlert && (
        <AlertDetailFullscreenModal
          alert={selectedAlert}
          open={Boolean(selectedId)}
          onClose={() => setSelectedId(null)}
          onReviewComplete={silentRefresh}
          onToast={(message, type) => setToast({ message, type })}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </AppShell>
  );
}
