"use client";

import type { FilterId } from "@/lib/alertFilters";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "prioritized", label: "Prioritized" },
  { id: "rejected", label: "Rejected" },
  { id: "resolved", label: "Resolved" },
];

interface Props {
  active: FilterId;
  counts: Record<string, number>;
  onChange: (status: FilterId) => void;
}

export function StatusFilterTabs({ active, counts, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTERS.map((f) => {
        const count = counts[f.id] ?? 0;
        const isActive = active === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40"
                : "bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            {f.label}
            {count > 0 && (
              <span className={`ml-1.5 ${isActive ? "text-cyan-400" : "text-slate-500"}`}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
