"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Toast } from "@/components/Toast";
import { ingestAlert, getHealth, getStats, API_BASE } from "@/lib/api";
import type { AlertIngest, AlertIngestResponse } from "@/lib/types";
import {
  Activity,
  CheckCircle2,
  Loader2,
  Play,
  Square,
  XCircle,
  ArrowRight,
  Radio,
} from "lucide-react";

interface StreamEvent {
  id: string;
  ts: Date;
  title: string;
  status: "accepted" | "rejected" | "duplicate" | "error";
  message: string;
  source: string;
  severity: string;
}

interface SampleAlertsFile {
  alerts: AlertIngest[];
}

const severityColors: Record<string, string> = {
  critical: "text-red-400 bg-red-500/15 border-red-500/30",
  high: "text-orange-400 bg-orange-500/15 border-orange-500/30",
  medium: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  low: "text-blue-400 bg-blue-500/15 border-blue-500/30",
  info: "text-slate-400 bg-slate-500/15 border-slate-500/30",
};

export function TriggerPage() {
  const [samples, setSamples] = useState<AlertIngest[]>([]);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [delayMs, setDelayMs] = useState(600);
  const [sent, setSent] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const stopRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/sample-alerts.json")
      .then((r) => r.json())
      .then((data: SampleAlertsFile) => setSamples(data.alerts ?? []))
      .catch(() => setToast({ message: "Failed to load sample alerts", type: "error" }));
  }, []);

  useEffect(() => {
    getHealth()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  const pushEvent = useCallback(
    (alert: AlertIngest, result: AlertIngestResponse | null, err?: string) => {
      const status: StreamEvent["status"] = err
        ? "error"
        : result?.accepted
          ? "accepted"
          : result?.status === "duplicate"
            ? "duplicate"
            : "rejected";

      setEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          ts: new Date(),
          title: alert.title,
          status,
          message: err ?? result?.message ?? "Unknown",
          source: alert.source,
          severity: alert.severity,
        },
      ]);

      setSent((n) => n + 1);
      if (status === "accepted") setAccepted((n) => n + 1);
      else if (status === "rejected" || status === "error") setRejected((n) => n + 1);
    },
    []
  );

  const sendOne = useCallback(
    async (alert: AlertIngest) => {
      try {
        const result = await ingestAlert(alert);
        pushEvent(alert, result);
        return result;
      } catch (err) {
        pushEvent(alert, null, err instanceof Error ? err.message : "Ingest failed");
        return null;
      }
    },
    [pushEvent]
  );

  const streamAll = useCallback(async () => {
    if (streaming || samples.length === 0) return;
    stopRef.current = false;
    setStreaming(true);
    setEvents([]);
    setSent(0);
    setAccepted(0);
    setRejected(0);

    for (const alert of samples) {
      if (stopRef.current) break;
      await sendOne(alert);
      if (delayMs > 0 && !stopRef.current) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    setStreaming(false);
    try {
      await getStats();
    } catch {
      /* ignore */
    }
  }, [streaming, samples, delayMs, sendOne]);

  const stopStream = () => {
    stopRef.current = true;
    setStreaming(false);
  };

  return (
    <AppShell
      subtitle="Stream monitoring events into the pipeline"
      showControls={false}
    >
      <div className="h-full max-w-7xl mx-auto w-full px-4 py-4 flex flex-col gap-4">
        {/* Status strip — Datadog-style metrics bar */}
        <div className="shrink-0 grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricCard
            label="Backend"
            value={backendOk === null ? "…" : backendOk ? "Connected" : "Offline"}
            icon={Radio}
            color={backendOk ? "text-emerald-400" : "text-red-400"}
          />
          <MetricCard label="Events Sent" value={String(sent)} icon={Activity} color="text-cyan-400" />
          <MetricCard label="Accepted" value={String(accepted)} icon={CheckCircle2} color="text-emerald-400" />
          <MetricCard label="Rejected" value={String(rejected)} icon={XCircle} color="text-red-400" />
          <MetricCard label="Sample Set" value={String(samples.length)} icon={Play} color="text-purple-400" />
        </div>

        <div className="flex-1 min-h-0 grid lg:grid-cols-12 gap-4">
          {/* Left: alert catalog */}
          <div className="lg:col-span-5 flex flex-col min-h-0 gap-3">
            <div className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                Event Catalog
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Delay
                  <select
                    value={delayMs}
                    onChange={(e) => setDelayMs(Number(e.target.value))}
                    disabled={streaming}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                  >
                    <option value={0}>Instant</option>
                    <option value={300}>300ms</option>
                    <option value={600}>600ms</option>
                    <option value={1000}>1s</option>
                    <option value={2000}>2s</option>
                  </select>
                </label>
                {streaming ? (
                  <button
                    type="button"
                    onClick={stopStream}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
                  >
                    <Square className="h-3 w-3" />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void streamAll()}
                    disabled={samples.length === 0 || backendOk === false}
                    className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
                  >
                    <Play className="h-3 w-3" />
                    Stream All
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {samples.map((alert, i) => (
                <div
                  key={`${alert.title}-${i}`}
                  className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${severityColors[alert.severity] ?? severityColors.info}`}
                      >
                        {alert.severity}
                      </span>
                      <span className="text-[10px] text-slate-500">{alert.source}</span>
                      <span className="text-[10px] text-slate-600">·</span>
                      <span className="text-[10px] text-slate-500">{alert.service}</span>
                    </div>
                    <p className="text-sm font-medium text-white truncate">{alert.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{alert.description}</p>
                  </div>
                  <button
                    type="button"
                    disabled={streaming || backendOk === false}
                    onClick={() => void sendOne(alert)}
                    className="shrink-0 rounded border border-slate-600 px-2 py-1 text-[10px] text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 disabled:opacity-40 transition-colors"
                  >
                    Send
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Right: live event stream */}
          <div className="lg:col-span-7 flex flex-col min-h-0 gap-3">
            <div className="shrink-0 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
                Live Event Stream
                {streaming && <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin" />}
              </h2>
              <Link
                href="/alerts"
                className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Review alerts
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div
              ref={logRef}
              className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-800 bg-[#070a12] font-mono text-xs p-3 space-y-1"
            >
              {events.length === 0 ? (
                <p className="text-slate-600 text-center py-12">
                  No events yet — click <span className="text-cyan-500">Stream All</span> or send individual
                  alerts to simulate real-time ingestion.
                </p>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="flex gap-2 leading-relaxed hover:bg-slate-900/40 px-1 rounded">
                    <span className="text-slate-600 shrink-0">
                      {ev.ts.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span
                      className={`shrink-0 uppercase font-semibold w-16 ${
                        ev.status === "accepted"
                          ? "text-emerald-400"
                          : ev.status === "duplicate"
                            ? "text-amber-400"
                            : ev.status === "error"
                              ? "text-red-400"
                              : "text-orange-400"
                      }`}
                    >
                      {ev.status}
                    </span>
                    <span className="text-slate-500 shrink-0">[{ev.source}]</span>
                    <span className="text-slate-300 truncate">{ev.title}</span>
                    <span className="text-slate-600 truncate hidden sm:inline">— {ev.message}</span>
                  </div>
                ))
              )}
            </div>

            <p className="shrink-0 text-[10px] text-slate-600 truncate">
              POST {API_BASE}/api/v1/alerts/ingest · polling pipeline every 3s on Monitor page
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </AppShell>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <p className={`mt-1 text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}
