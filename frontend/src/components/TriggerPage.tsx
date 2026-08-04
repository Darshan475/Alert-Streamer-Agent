"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { Toast } from "@/components/Toast";
import { generateAgentAlert, getHealth, getStats, API_BASE } from "@/lib/api";
import type { AlertIngest, AlertIngestResponse } from "@/lib/types";
import {
  Activity,
  Bot,
  CheckCircle2,
  Loader2,
  Play,
  Sparkles,
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

function alertRowMeta(alert: AlertIngest) {
  const meta = alert.metadata ?? {};
  return {
    id: String(meta.incident_id ?? "—"),
    date: String(meta.opened_date ?? new Date().toLocaleDateString()),
    priority: String(meta.priority_label ?? "3-Medium"),
    monitor: String(meta.monitor ?? alert.source ?? "Datadog"),
  };
}

export function TriggerPage() {
  const [generated, setGenerated] = useState<AlertIngest[]>([]);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [delayMs, setDelayMs] = useState(800);
  const [streamCount, setStreamCount] = useState(5);
  const [hint, setHint] = useState("");
  const [sent, setSent] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [duplicates, setDuplicates] = useState(0);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const stopRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHealth()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
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
        ...prev.slice(-49),
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
      else if (status === "duplicate") setDuplicates((n) => n + 1);
      else if (status === "rejected" || status === "error") setRejected((n) => n + 1);
    },
    []
  );

  const generateAndIngest = useCallback(
    async (scenarioHint?: string) => {
      setGenerating(true);
      try {
        const res = await generateAgentAlert(scenarioHint || hint || undefined);
        setGenerated((prev) => [res.alert, ...prev].slice(0, 12));
        pushEvent(res.alert, res.ingest);
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent generation failed";
        setToast({ message, type: "error" });
        pushEvent(
          {
            source: "datadog",
            alert_type: "generation_error",
            title: scenarioHint || hint || "Alert generation failed",
            description: message,
            severity: "high",
            service: "pss-bws",
            environment: "production",
          },
          null,
          message
        );
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [hint, pushEvent]
  );

  const autoStream = useCallback(async () => {
    if (streaming || backendOk === false) return;
    stopRef.current = false;
    setStreaming(true);
    setEvents([]);
    setSent(0);
    setAccepted(0);
    setRejected(0);
    setDuplicates(0);

    for (let i = 0; i < streamCount; i++) {
      if (stopRef.current) break;
      await generateAndIngest(hint || undefined);
      if (delayMs > 0 && !stopRef.current && i < streamCount - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    setStreaming(false);
    try {
      await getStats();
    } catch {
      /* ignore */
    }
  }, [streaming, backendOk, streamCount, delayMs, hint, generateAndIngest]);

  const stopStream = () => {
    stopRef.current = true;
    setStreaming(false);
  };

  return (
    <AppShell subtitle="PSS BWS · Datadog alert generation" showControls>
      <div className="relative h-full max-w-7xl mx-auto w-full px-3 sm:px-4 py-3 sm:py-4 flex flex-col gap-3 sm:gap-4 overflow-hidden">
        <LoadingOverlay show={generating && !streaming} label="Generating PSS BWS alert…" />

        <div className="shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          <MetricCard
            label="Backend"
            value={backendOk === null ? "…" : backendOk ? "Connected" : "Offline"}
            icon={Radio}
            color={backendOk ? "text-emerald-400" : "text-red-400"}
          />
          <MetricCard label="Events Sent" value={String(sent)} icon={Activity} color="text-cyan-400" />
          <MetricCard label="Accepted" value={String(accepted)} icon={CheckCircle2} color="text-emerald-400" />
          <MetricCard label="Rejected" value={String(rejected)} icon={XCircle} color="text-red-400" />
          <MetricCard label="Duplicates" value={String(duplicates)} icon={Loader2} color="text-amber-400" />
          <MetricCard label="Agent Gen" value={String(generated.length)} icon={Bot} color="text-purple-400" />
        </div>

        <div className="shrink-0 rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/5 to-cyan-500/5 p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2 text-violet-300">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Alert Generator Agent</span>
          </div>
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Optional hint (e.g. SQS volume, API 5xx…)"
            className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Count
              <select
                value={streamCount}
                onChange={(e) => setStreamCount(Number(e.target.value))}
                disabled={streaming}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
              >
                {[3, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Delay
              <select
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                disabled={streaming}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
              >
                <option value={0}>Instant</option>
                <option value={500}>500ms</option>
                <option value={800}>800ms</option>
                <option value={1500}>1.5s</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void generateAndIngest()}
              disabled={generating || streaming || backendOk === false}
              className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-40"
            >
              <Bot className="h-3 w-3" />
              Generate One
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={stopStream}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void autoStream()}
                disabled={backendOk === false}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
              >
                <Play className="h-3 w-3" />
                Auto Stream
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <div className="flex flex-col min-h-[220px] lg:min-h-0 gap-2">
            <h2 className="shrink-0 text-sm font-medium text-slate-400 uppercase tracking-wider">
              Generated Preview ({generated.length})
            </h2>
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 scroll-panel space-y-2">
              {generated.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-10 border border-dashed border-slate-700 rounded-xl">
                  No alerts yet — click Generate One
                </p>
              ) : (
                generated.map((alert, i) => {
                  const row = alertRowMeta(alert);
                  return (
                    <GeneratedPreviewCard key={`${row.id}-${i}`} alert={alert} row={row} />
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-col min-h-[220px] lg:min-h-0 gap-2">
            <div className="shrink-0 flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
                Live Event Stream
                {streaming && <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin" />}
              </h2>
              <Link
                href="/alerts"
                className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors shrink-0"
              >
                Review
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div
              ref={logRef}
              className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-800 bg-[#070a12] font-mono text-xs p-3 space-y-1 scroll-panel"
            >
              {events.length === 0 ? (
                <p className="text-slate-500 text-center py-10 text-sm">
                  Click <span className="text-cyan-400">Generate One</span> to start
                </p>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="flex flex-wrap sm:flex-nowrap gap-x-2 gap-y-0.5 leading-relaxed hover:bg-slate-900/40 px-1 rounded py-0.5">
                    <span className="text-slate-500 shrink-0">
                      {ev.ts.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span
                      className={`shrink-0 uppercase font-semibold ${
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
                    <span className="text-slate-200 break-words min-w-0 flex-1">{ev.title}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
    </AppShell>
  );
}

function GeneratedPreviewCard({
  alert,
  row,
}: {
  alert: AlertIngest;
  row: ReturnType<typeof alertRowMeta>;
}) {
  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3 sm:p-4 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-slate-500 block text-[10px] uppercase tracking-wide">ID</span>
          <span className="text-cyan-400 font-mono text-sm">{row.id}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase tracking-wide">Date</span>
          <span className="text-slate-200 text-sm">{row.date}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase tracking-wide">Priority</span>
          <span className="text-amber-300 text-sm">{row.priority}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px] uppercase tracking-wide">Tool</span>
          <span className="text-slate-200 text-sm">{row.monitor}</span>
        </div>
      </div>
      <p className="text-sm sm:text-base text-white leading-snug break-words">{alert.title}</p>
      {alert.description && alert.description !== alert.title && (
        <p className="text-xs text-slate-400 line-clamp-2">{alert.description}</p>
      )}
    </div>
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
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-2.5 sm:p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <p className={`mt-1 text-base sm:text-lg font-semibold truncate ${color}`}>{value}</p>
    </div>
  );
}
