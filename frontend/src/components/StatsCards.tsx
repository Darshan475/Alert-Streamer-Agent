"use client";

import type { PipelineStats } from "@/lib/types";
import { Activity, AlertTriangle, Users, Layers } from "lucide-react";

interface Props {
  stats: PipelineStats | undefined;
  llmConfigured?: boolean;
  llmProvider?: string;
  model?: string;
}

export function StatsCards({ stats, llmConfigured, llmProvider, model }: Props) {
  const cards = [
    {
      label: "Total Alerts",
      value: stats?.total_alerts ?? 0,
      icon: Activity,
      color: "text-cyan-400",
    },
    {
      label: "Investigating",
      value: stats?.by_status?.investigating ?? 0,
      icon: AlertTriangle,
      color: "text-amber-400",
    },
    {
      label: "Resolved",
      value: stats?.by_status?.resolved ?? 0,
      icon: Layers,
      color: "text-emerald-400",
    },
    {
      label: "Teams Active",
      value: Object.keys(stats?.by_team ?? {}).length,
      icon: Users,
      color: "text-purple-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4 backdrop-blur"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">{card.label}</span>
            <card.icon className={`h-4 w-4 ${card.color}`} />
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">{card.value}</p>
        </div>
      ))}
      <div className="col-span-2 lg:col-span-4 rounded-xl border border-slate-700/60 bg-slate-900/30 px-4 py-2 flex items-center justify-between text-sm">
        <span className="text-slate-400">LLM Engine</span>
        <span className={llmConfigured ? "text-emerald-400" : "text-amber-400"}>
          {llmConfigured
            ? `${llmProvider ?? "LLM"} · ${model}`
            : `No API key — set LLM_API_KEY (${llmProvider ?? "openrouter"})`}
        </span>
      </div>
    </div>
  );
}
