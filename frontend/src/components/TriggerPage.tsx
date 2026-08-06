"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { Toast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAlertStream } from "@/hooks/useAlertStream";
import { agentAutoStream, agentGeneratorChat, generateAgentAlert, getHealth } from "@/lib/api";
import { maskIngestForDisplay } from "@/lib/maskDisplay";
import {
  clearTriggerSession,
  loadTriggerSession,
  saveTriggerSession,
} from "@/lib/triggerSessionCache";
import type { AlertIngest, AlertIngestResponse } from "@/lib/types";
import {
  Activity,
  Bot,
  CheckCircle2,
  Loader2,
  Play,
  Send,
  Sparkles,
  Square,
  Trash2,
  XCircle,
  ArrowRight,
  Radio,
} from "lucide-react";

const SUGGESTED_PROMPTS = [
  "Generate 2 prioritized alerts",
  "Provide duplicate data",
  "Create 2 rejected alerts",
  "Show resolved alert data",
] as const;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

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
  const { applySnapshot } = useAlertStream();
  const [generated, setGenerated] = useState<AlertIngest[]>([]);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [delayMs, setDelayMs] = useState(800);
  const [streamCount, setStreamCount] = useState(7);
  const [sent, setSent] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [duplicates, setDuplicates] = useState(0);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showClearLocalConfirm, setShowClearLocalConfirm] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const stopRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHealth()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));

    const saved = loadTriggerSession();
    if (saved) {
      setGenerated(saved.generated);
      setEvents(
        saved.events.map((ev) => ({
          ...ev,
          ts: new Date(ev.ts),
          status: ev.status as StreamEvent["status"],
        }))
      );
      setSent(saved.metrics.sent);
      setAccepted(saved.metrics.accepted);
      setRejected(saved.metrics.rejected);
      setDuplicates(saved.metrics.duplicates);
      setStreamCount(saved.streamCount || 7);
    }
  }, []);

  useEffect(() => {
    saveTriggerSession({
      generated,
      events: events.map((ev) => ({
        id: ev.id,
        ts: ev.ts.toISOString(),
        title: ev.title,
        status: ev.status,
        message: ev.message,
        source: ev.source,
        severity: ev.severity,
      })),
      metrics: { sent, accepted, rejected, duplicates },
      streamCount,
    });
  }, [generated, events, sent, accepted, rejected, duplicates, streamCount]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages]);

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

  const syncSnapshot = useCallback(
    (snapshot: import("@/lib/types").StreamSnapshot) => {
      applySnapshot(snapshot);
    },
    [applySnapshot],
  );

  const generateAndIngest = useCallback(async () => {
      setGenerating(true);
      try {
        const res = await generateAgentAlert();
        const display = maskIngestForDisplay(res.alert);
        setGenerated((prev) => [display, ...prev].slice(0, 12));
        pushEvent(display, res.ingest);
        syncSnapshot(res.snapshot);
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent generation failed";
        setToast({ message, type: "error" });
        pushEvent(
          {
            source: "datadog",
            alert_type: "generation_error",
            title: "Alert generation failed",
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
    [pushEvent, syncSnapshot]
  );

  const sendChat = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? chatInput).trim();
    if (!text || chatLoading || backendOk === false) return;

    if (!textOverride) setChatInput("");
    setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);
    setChatLoading(true);

    try {
      const res = await agentGeneratorChat(text);
      setChatMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: res.reply },
      ]);
      syncSnapshot(res.snapshot);

      if (res.alerts.length > 0) {
        const masked = res.alerts.map(maskIngestForDisplay);
        setGenerated((prev) => [...masked, ...prev].slice(0, 12));
        masked.forEach((alert, i) => {
          pushEvent(alert, res.results[i] ?? null);
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat request failed";
      setChatMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: message },
      ]);
      setToast({ message, type: "error" });
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatLoading, backendOk, pushEvent, syncSnapshot]);

  const autoStream = useCallback(async () => {
    if (streaming || backendOk === false) return;
    stopRef.current = false;
    setStreaming(true);
    setEvents([]);
    setSent(0);
    setAccepted(0);
    setRejected(0);
    setDuplicates(0);

    try {
      const res = await agentAutoStream(streamCount);
      syncSnapshot(res.snapshot);

      const accepted = res.results.filter((r) => r.accepted).length;
      const duplicates = res.results.filter((r) => r.status === "duplicate").length;
      const rejected = res.results.filter((r) => r.status === "rejected").length;
      const stored = res.snapshot.alerts.items.length;
      setToast({
        message: `${stored} alert(s) synced to Monitor Pipeline (${accepted} prioritized, ${duplicates} duplicate, ${rejected} rejected).`,
        type: "success",
      });

      setGenerated((prev) => [...res.alerts.map(maskIngestForDisplay), ...prev].slice(0, 12));
      res.alerts.forEach((alert, i) => {
        pushEvent(maskIngestForDisplay(alert), res.results[i] ?? null);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auto stream failed";
      setToast({ message, type: "error" });
    } finally {
      setStreaming(false);
    }
  }, [streaming, backendOk, streamCount, pushEvent, syncSnapshot]);

  const clearLocal = useCallback(() => {
    setGenerated([]);
    setEvents([]);
    setSent(0);
    setAccepted(0);
    setRejected(0);
    setDuplicates(0);
    setChatMessages([]);
    clearTriggerSession();
    setShowClearLocalConfirm(false);
    setToast({ message: "Trigger preview and stream log cleared.", type: "success" });
  }, []);

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

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          {/* Left: Generator + Preview */}
          <div className="flex flex-col min-h-[280px] lg:min-h-0 gap-2">
            <h2 className="shrink-0 text-sm font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-violet-400" />
              Alert Generator
            </h2>
            <div className="shrink-0 rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-500/5 to-cyan-500/5 flex flex-col overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border-b border-slate-800/50">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                  Count
                  <select
                    value={streamCount}
                    onChange={(e) => setStreamCount(Number(e.target.value))}
                    disabled={streaming}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-white"
                  >
                    {[5, 7, 10, 15].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                  Delay
                  <select
                    value={delayMs}
                    onChange={(e) => setDelayMs(Number(e.target.value))}
                    disabled={streaming}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-white"
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
                  className="flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300 hover:bg-violet-500/20 disabled:opacity-40 shrink-0"
                >
                  <Bot className="h-3 w-3" />
                  Generate One
                </button>
                {streaming ? (
                  <button
                    type="button"
                    onClick={stopStream}
                    className="flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300"
                  >
                    <Square className="h-3 w-3" />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void autoStream()}
                    disabled={backendOk === false}
                    className="flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40"
                  >
                    <Play className="h-3 w-3" />
                    Auto Stream
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 px-3 py-1.5 border-b border-slate-800/50">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={chatLoading || backendOk === false}
                    onClick={() => void sendChat(prompt)}
                    className="rounded-full border border-slate-700/80 bg-slate-900/60 px-2.5 py-0.5 text-[10px] text-slate-400 hover:text-violet-300 hover:border-violet-500/40 hover:bg-violet-500/10 disabled:opacity-40 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {chatMessages.length > 0 && (
                <div
                  ref={chatRef}
                  className="max-h-[72px] overflow-y-auto px-3 py-1.5 space-y-1 text-[11px] scroll-panel"
                >
                  {chatMessages.slice(-4).map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded px-2 py-0.5 truncate ${
                        msg.role === "user"
                          ? "text-violet-300"
                          : "text-slate-400"
                      }`}
                    >
                      <span className="font-medium">{msg.role === "user" ? "You: " : "AI: "}</span>
                      {msg.text}
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Processing…
                    </div>
                  )}
                </div>
              )}

              <form
                className="flex gap-1.5 p-2 border-t border-slate-800/50"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChat();
                }}
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={chatLoading || backendOk === false}
                  placeholder="Ask for alert data…"
                  maxLength={500}
                  className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                />
                <button
                  type="submit"
                  disabled={chatLoading || !chatInput.trim() || backendOk === false}
                  className="shrink-0 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-violet-300 hover:bg-violet-500/20 disabled:opacity-40"
                  aria-label="Send chat message"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>

            <div className="flex flex-col flex-1 min-h-0 gap-2">
              <div className="shrink-0 flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                  Generated Preview ({generated.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setShowClearLocalConfirm(true)}
                  disabled={generated.length === 0 && events.length === 0}
                  className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[10px] text-slate-400 hover:text-red-300 hover:border-red-500/40 disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear local
                </button>
              </div>
              <div className="flex-1 min-h-[160px] lg:min-h-0 overflow-y-auto pr-1 scroll-panel space-y-1.5">
                {generated.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-10 h-full flex items-center justify-center border border-dashed border-slate-700 rounded-xl">
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
          </div>

          {/* Right: Live Event Stream — full height */}
          <div className="flex flex-col min-h-[280px] lg:min-h-0 gap-2">
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
              className="flex-1 min-h-[200px] lg:min-h-0 overflow-y-auto rounded-xl border border-slate-800 bg-[#070a12] font-mono text-xs p-3 space-y-1 scroll-panel"
            >
              {events.length === 0 ? (
                <p className="text-slate-500 text-center py-10 text-sm h-full flex items-center justify-center">
                  Click <span className="text-cyan-400 mx-1">Generate One</span> to start
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

      <ConfirmDialog
        open={showClearLocalConfirm}
        onOpenChange={setShowClearLocalConfirm}
        title="Clear local session?"
        description="This removes generated previews, stream log entries, and chat history from this browser session. Alerts already synced to Monitor Pipeline are not affected."
        confirmLabel="Clear local data"
        variant="danger"
        onConfirm={clearLocal}
        details={
          <span>
            <span className="font-medium text-red-300">{generated.length}</span> preview
            {generated.length === 1 ? "" : "s"} and{" "}
            <span className="font-medium text-red-300">{events.length}</span> log entr
            {events.length === 1 ? "y" : "ies"} will be removed.
          </span>
        }
      />
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
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[9px] sm:text-[10px] text-slate-500 mb-1">
        <span className="text-cyan-400 font-mono shrink-0">ID {row.id}</span>
        <span className="shrink-0">{row.date}</span>
        <span className="text-amber-300 shrink-0">{row.priority}</span>
        <span className="shrink-0">{row.monitor}</span>
        <span className="rounded border border-yellow-500/30 px-1 py-px text-yellow-300/90 capitalize shrink-0">
          {alert.severity}
        </span>
        <span className="truncate min-w-0 text-slate-400 sm:hidden">{alert.service}</span>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <p className="text-xs sm:text-sm text-white leading-snug truncate min-w-0 flex-[1.3]">
          {alert.title}
        </p>
        {alert.description && alert.description !== alert.title && (
          <p className="text-[10px] sm:text-xs text-slate-400 truncate min-w-0 flex-1 hidden sm:block">
            {alert.description}
          </p>
        )}
        <span className="text-[9px] text-slate-500 shrink-0 hidden md:inline">{alert.service}</span>
      </div>
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
