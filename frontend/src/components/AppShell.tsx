"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AiChat } from "@/components/AiChat";
import { LlmSelector } from "@/components/LlmSelector";
import { Radio, RefreshCw, Zap, ShieldCheck } from "lucide-react";

const NAV = [
  { href: "/trigger", label: "Trigger Events", icon: Zap },
  { href: "/alerts", label: "Monitor & Review", icon: ShieldCheck },
] as const;

interface AppShellProps {
  children: React.ReactNode;
  subtitle?: string;
  onRefresh?: () => void;
  onLlmChanged?: (message: string) => void;
  showControls?: boolean;
  live?: boolean;
  chatAlertId?: string | null;
}

export function AppShell({
  children,
  subtitle = "Validate and Review Trigger Events",
  onRefresh,
  onLlmChanged,
  showControls = true,
  live = false,
  chatAlertId = null,
}: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="h-screen flex flex-col bg-[#0b0f19] text-slate-200 overflow-hidden">
      <header className="shrink-0 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur z-20">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/alerts" className="flex items-center gap-3 min-w-0 group">
              <div className="rounded-lg bg-cyan-500/10 p-2 shrink-0 group-hover:bg-cyan-500/15 transition-colors">
                <Radio className="h-5 w-5 text-cyan-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold text-white truncate">Alert Streamer</h1>
                  {live && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400 uppercase tracking-wide">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Live
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate hidden sm:block">{subtitle}</p>
              </div>
            </Link>
          </div>

          {showControls && (
            <div className="flex items-center gap-3 shrink-0">
              <LlmSelector compact onChanged={onLlmChanged} />
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:border-slate-500 transition-colors active:scale-95 shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              )}
            </div>
          )}
        </div>

        <nav className="max-w-7xl mx-auto px-4 flex gap-1 border-t border-slate-800/60">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  active
                    ? "border-cyan-400 text-cyan-300"
                    : "border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-600"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      <AiChat selectedAlertId={chatAlertId} />
    </div>
  );
}
