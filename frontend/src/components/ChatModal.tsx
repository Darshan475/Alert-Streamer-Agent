"use client";

import { useEffect, useRef, useState } from "react";
import { sendChat } from "@/lib/api";
import { Bot, MessageCircle, Send, Loader2, X, Sparkles } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  selectedAlertId: string | null;
}

export function ChatModal({ selectedAlertId }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Alert Streamer copilot. Ask about alerts, investigations, or human-review steps. Select an alert for context-aware answers.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await sendChat(text, selectedAlertId ?? undefined);
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Failed to reach API"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Floating action button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open alert assistant"
        className={`chat-fab group fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 text-white shadow-lg shadow-cyan-500/25 transition-transform hover:scale-105 active:scale-95 ${open ? "pointer-events-none scale-0 opacity-0" : "scale-100 opacity-100"}`}
      >
        <span className="chat-fab-ring absolute inset-0 rounded-full" aria-hidden />
        <MessageCircle className="h-6 w-6 relative z-10 group-hover:scale-110 transition-transform" />
        <Sparkles className="h-3 w-3 absolute top-2 right-2 text-cyan-100 opacity-80" />
      </button>

      {/* Overlay + modal */}
      <div
        className={`fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6 transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        <button
          type="button"
          aria-label="Close chat"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />

        <div
          className={`chat-modal relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/95 shadow-2xl shadow-cyan-500/10 backdrop-blur-xl transition-all duration-300 ease-out ${open ? "translate-y-0 scale-100 opacity-100" : "translate-y-8 scale-95 opacity-0"}`}
          style={{ height: "min(560px, calc(100vh - 3rem))" }}
        >
          <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20">
              <Bot className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white text-sm">Alert Assistant</p>
              <p className="text-xs text-slate-500 truncate">
                {selectedAlertId ? "Alert context active" : "General pipeline enquiry"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2 animate-fade-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <Bot className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
                )}
                <div
                  className={`rounded-2xl px-3 py-2 text-sm max-w-[85%] ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-cyan-600/30 to-cyan-700/20 text-cyan-50 rounded-br-md"
                      : "bg-slate-800/90 text-slate-300 rounded-bl-md"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSend} className="border-t border-slate-800 p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about alerts or human review…"
              className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 disabled:opacity-40 px-4 py-2.5 text-white transition-all"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
