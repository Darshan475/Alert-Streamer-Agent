"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { usePathname } from "next/navigation";
import { batchReviewAlerts, sendChat } from "@/lib/api";
import type { ChatAction } from "@/lib/types";
import { Bot, MessageCircle, Send, Sparkles, X, Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[];
}

interface Props {
  selectedAlertId?: string | null;
}

const PAGE_PROMPTS: Record<string, { label: string; prompt: string }[]> = {
  "/trigger": [
    { label: "Generate alert", prompt: "Generate a new critical production alert and ingest it." },
    { label: "Auto stream", prompt: "Explain how the agent auto-stream works on this page." },
    { label: "Pipeline", prompt: "What agent steps run after an alert is ingested?" },
  ],
  "/alerts": [
    { label: "Group pending", prompt: "Group all pending_review alerts by service and show combined groups." },
    { label: "Approve group", prompt: "Find grouped pending alerts and prepare batch approve actions for me." },
    { label: "P1 review list", prompt: "List all P1/P2 alerts that need human review right now." },
    { label: "Summarize stream", prompt: "Summarize the current alert stream by severity and status." },
  ],
};

export function AiChat({ selectedAlertId = null }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const pageKey = pathname.startsWith("/trigger") ? "/trigger" : "/alerts";
  const quickPrompts = PAGE_PROMPTS[pageKey] ?? PAGE_PROMPTS["/alerts"];

  const welcome =
    pageKey === "/trigger"
      ? "Hi! I'm your **agent copilot**. I generate alerts, run the triage/investigation pipeline, and can trigger events — no JSON files."
      : "Hi! I'm your **agent copilot**. Ask me to **group pending alerts** or **approve combined batches**. Select an alert for context.";

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "assistant", content: welcome }]);
    }
  }, [open, messages.length, welcome]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, loading]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      setMessages((prev) => [...prev, { role: "user", content: text.trim() }]);
      setLoading(true);
      try {
        const res = await sendChat(text.trim(), selectedAlertId ?? undefined);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.reply,
            actions: res.actions?.length ? res.actions : undefined,
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `**Error:** ${err instanceof Error ? err.message : "Failed to reach API"}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, selectedAlertId]
  );

  async function handleBatchApprove(action: ChatAction) {
    if (!action.alert_ids.length || loading) return;
    setLoading(true);
    try {
      const result = await batchReviewAlerts({
        alert_ids: action.alert_ids,
        decision: "approve",
        feedback: `Batch approved: ${action.label}`,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `**Approved ${result.count} alert(s)** in group "${action.label}".${result.failed.length ? ` Failed: ${result.failed.length}` : ""}`,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `**Batch approve failed:** ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    void sendMessage(text);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Open AI assistant"
          className="group fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-white shadow-lg shadow-cyan-500/30 transition-all hover:scale-105 active:scale-95 data-[state=open]:scale-0 data-[state=open]:opacity-0"
        >
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/40 to-violet-400/40 animate-ping opacity-40" />
          <MessageCircle className="h-6 w-6 relative z-10" />
          <Sparkles className="h-3 w-3 absolute top-2.5 right-2.5 text-cyan-100" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed bottom-4 right-4 z-50 flex w-[min(100vw-2rem,420px)] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/95 shadow-2xl shadow-cyan-500/10 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4" style={{ height: "min(580px, calc(100vh - 2rem))" }}>
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20">
              <Bot className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="font-medium text-white text-sm">Alert Streamer AI</Dialog.Title>
              <Dialog.Description className="text-xs text-slate-500 truncate">
                {selectedAlertId ? "Alert context active" : "Live pipeline & alert data"}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-panel">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 mt-0.5">
                    <Bot className="h-4 w-4 text-cyan-400" />
                  </div>
                )}
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm max-w-[88%] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-cyan-600/35 to-violet-600/20 text-cyan-50 rounded-br-md"
                      : "bg-[#232b3b] text-slate-200 rounded-bl-md border border-slate-700/40"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1.5 mb-2">{children}</ol>,
                        ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 mb-2">{children}</ul>,
                        li: ({ children }) => <li className="text-slate-300">{children}</li>,
                        strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.actions.map((act) => (
                        <button
                          key={`${act.label}-${act.alert_ids.join(",")}`}
                          type="button"
                          disabled={loading}
                          onClick={() => void handleBatchApprove(act)}
                          className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                        >
                          {act.label || `Approve ${act.alert_ids.length}`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2.5 pl-9">
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:0ms]" />
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:150ms]" />
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:300ms]" />
                </div>
                <span className="text-xs text-slate-500">Thinking…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick actions — investigate / escalate dummy prompts */}
          <div className="shrink-0 flex flex-wrap gap-1.5 px-3 pb-2">
            {quickPrompts.map(({ label, prompt }) => (
              <button
                key={label}
                type="button"
                disabled={loading}
                onClick={() => void sendMessage(prompt)}
                className="rounded-full border border-slate-700/80 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300 transition-colors disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-slate-800 p-3 flex gap-2 shrink-0">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about alerts, investigation, escalation…"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-cyan-600 to-violet-600 text-white disabled:opacity-40 hover:from-cyan-500 hover:to-violet-500 transition-all"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
