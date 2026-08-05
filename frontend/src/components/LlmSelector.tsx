"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { getLlmProviders, setLlmModel, setLlmProvider } from "@/lib/api";
import type { LlmProviderId, LlmProvidersResponse } from "@/lib/types";
import { ChevronDown, Sparkles } from "lucide-react";

interface Props {
  onChanged?: (message: string) => void;
  compact?: boolean;
}

export function LlmSelector({ onChanged, compact = false }: Props) {
  const { data, mutate, isLoading } = useSWR<LlmProvidersResponse>("llm-providers", getLlmProviders, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const [saving, setSaving] = useState(false);

  const active = data?.providers.find((p) => p.id === data.active_provider);
  const activeConfigured = active?.id === "offline" ? true : active?.configured ?? false;
  const openrouterModels = active?.models ?? [];
  const activeModel = data?.active_model ?? active?.model ?? "";

  const handleProviderChange = useCallback(
    async (providerId: LlmProviderId) => {
      if (providerId === data?.active_provider || saving) return;
      setSaving(true);
      try {
        const result = await setLlmProvider(providerId);
        await mutate();
        onChanged?.(result.message);
      } catch (err) {
        onChanged?.(err instanceof Error ? err.message : "Failed to switch LLM provider");
      } finally {
        setSaving(false);
      }
    },
    [data?.active_provider, mutate, onChanged, saving]
  );

  const handleModelChange = useCallback(
    async (model: string) => {
      if (model === activeModel || saving) return;
      setSaving(true);
      try {
        const result = await setLlmModel(model);
        await mutate();
        onChanged?.(result.message);
      } catch (err) {
        onChanged?.(err instanceof Error ? err.message : "Failed to switch model");
      } finally {
        setSaving(false);
      }
    },
    [activeModel, mutate, onChanged, saving]
  );

  const statusText = (() => {
    if (!active) return "Loading…";
    if (active.id === "offline") return "Offline";
    if (activeConfigured) return activeModel;
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
        <div className="relative min-w-[140px] max-w-[160px]">
          <select
            value={data?.active_provider ?? "nvidia"}
            onChange={(e) => void handleProviderChange(e.target.value as LlmProviderId)}
            disabled={isLoading || saving || !data}
            className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-900/80 py-1.5 pl-2.5 pr-8 text-xs text-white focus:border-cyan-500 focus:outline-none disabled:opacity-60"
            aria-label="Select LLM provider"
          >
            {(data?.providers ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
                {provider.is_default ? " ★" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>
        {data?.active_provider === "openrouter" && openrouterModels.length > 0 && (
          <div className="relative min-w-[160px] max-w-[200px] hidden md:block">
            <select
              value={activeModel}
              onChange={(e) => void handleModelChange(e.target.value)}
              disabled={isLoading || saving}
              className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-900/80 py-1.5 pl-2.5 pr-8 text-xs text-white focus:border-violet-500 focus:outline-none disabled:opacity-60"
              aria-label="Select OpenRouter model"
            >
              {openrouterModels.map((m) => (
                <option key={m} value={m}>
                  {m.includes("nemotron") ? `Nemotron · ${m.split("/").pop()}` : m.split("/").pop()}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        )}
        <span className={`hidden lg:inline text-xs truncate max-w-[120px] ${statusColor}`}>
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <select
          value={data?.active_provider ?? "openrouter"}
          onChange={(e) => void handleProviderChange(e.target.value as LlmProviderId)}
          disabled={isLoading || saving || !data}
          className="min-w-[200px] rounded-lg border border-slate-600 bg-slate-950/80 py-2 pl-3 pr-9 text-sm text-white"
        >
          {(data?.providers ?? []).map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.label}</option>
          ))}
        </select>
        {data?.active_provider === "openrouter" && (
          <select
            value={activeModel}
            onChange={(e) => void handleModelChange(e.target.value)}
            disabled={saving}
            className="min-w-[240px] rounded-lg border border-violet-600/40 bg-slate-950/80 py-2 pl-3 text-sm text-white"
          >
            {openrouterModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        <span className={`text-sm ${statusColor}`}>{statusText}</span>
      </div>
    </div>
  );
}
