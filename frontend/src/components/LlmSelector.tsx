"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { getLlmProviders, setLlmProvider } from "@/lib/api";
import type { LlmProviderId, LlmProvidersResponse } from "@/lib/types";
import { ChevronDown, Sparkles } from "lucide-react";

interface Props {
  onChanged?: (message: string) => void;
  compact?: boolean;
}

export function LlmSelector({ onChanged, compact = false }: Props) {
  const { data, mutate, isLoading } = useSWR<LlmProvidersResponse>("llm-providers", getLlmProviders);
  const [saving, setSaving] = useState(false);

  const active = data?.providers.find((p) => p.id === data.active_provider);
  const activeConfigured = active?.id === "offline" ? true : active?.configured ?? false;

  const handleChange = useCallback(
    async (providerId: LlmProviderId) => {
      if (providerId === data?.active_provider || saving) return;
      setSaving(true);
      try {
        const result = await setLlmProvider(providerId);
        await mutate();
        onChanged?.(result.message);
      } catch (err) {
        onChanged?.(
          err instanceof Error ? err.message : "Failed to switch LLM provider"
        );
      } finally {
        setSaving(false);
      }
    },
    [data?.active_provider, mutate, onChanged, saving]
  );

  const statusText = (() => {
    if (!active) return "Loading…";
    if (active.id === "offline") return "Offline";
    if (activeConfigured) return active.model;
    return "Needs key";
  })();

  const statusColor =
    active?.id === "offline" || activeConfigured ? "text-emerald-400" : "text-amber-400";

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
          <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
          <span>LLM</span>
        </div>
        <div className="relative min-w-[160px] max-w-[200px]">
          <select
            value={data?.active_provider ?? "gemini"}
            onChange={(e) => void handleChange(e.target.value as LlmProviderId)}
            disabled={isLoading || saving || !data}
            className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-900/80 py-1.5 pl-2.5 pr-8 text-xs text-white focus:border-cyan-500 focus:outline-none disabled:opacity-60"
            aria-label="Select LLM provider"
          >
            {(data?.providers ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
                {provider.is_default ? " (default)" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>
        <span className={`hidden md:inline text-xs truncate max-w-[140px] ${statusColor}`}>
          {saving ? "Switching…" : statusText}
        </span>
      </div>
    );
  }

  return (
    <div className="col-span-2 lg:col-span-4 rounded-xl border border-slate-700/60 bg-slate-900/30 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm">
        <Sparkles className="h-4 w-4 text-cyan-400 shrink-0" />
        <span className="text-slate-400">LLM Engine</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 sm:min-w-0">
        <div className="relative min-w-[220px]">
          <select
            value={data?.active_provider ?? "gemini"}
            onChange={(e) => void handleChange(e.target.value as LlmProviderId)}
            disabled={isLoading || saving || !data}
            className="w-full appearance-none rounded-lg border border-slate-600 bg-slate-950/80 py-2 pl-3 pr-9 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:opacity-60"
            aria-label="Select LLM provider"
          >
            {(data?.providers ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
                {provider.is_default ? " (default)" : ""}
                {provider.free ? " · free" : ""}
                {!provider.configured && provider.id !== "offline" ? " · needs key" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>

        <span className={`text-sm truncate ${statusColor}`}>{saving ? "Switching…" : statusText}</span>
      </div>
    </div>
  );
}
