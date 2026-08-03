import type { AlertSeverity, AlertStatus, Team } from "./types";

export function severityColor(severity: AlertSeverity): string {
  const colors: Record<AlertSeverity, string> = {
    critical: "bg-red-500/20 text-red-300 border-red-500/40",
    high: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    medium: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    low: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    info: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  };
  return colors[severity];
}

export function statusColor(status: AlertStatus): string {
  const colors: Record<AlertStatus, string> = {
    received: "text-slate-400",
    validated: "text-blue-400",
    deduplicated: "text-purple-400",
    prioritized: "text-indigo-400",
    assigned: "text-cyan-400",
    investigating: "text-amber-400 animate-pulse",
    pending_review: "text-violet-400 animate-pulse",
    escalated: "text-orange-400 font-semibold",
    resolved: "text-emerald-400",
    duplicate: "text-slate-500",
    rejected: "text-red-400",
  };
  return colors[status];
}

export function priorityLabel(priority: number): string {
  return `P${priority}`;
}

export function teamLabel(team: Team): string {
  return team.charAt(0).toUpperCase() + team.slice(1);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
