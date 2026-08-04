"use client";

import { useState, useRef, useEffect } from "react";
import { sendChat } from "@/lib/api";
import { MessageCircle, Send, Loader2, Bot } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  selectedAlertId: string | null;
}

export function Chatbot({ selectedAlertId }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm the Alert Streamer assistant. Ask about alerts, priorities, investigations, or pipeline status. Select an alert for context-aware answers.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 flex flex-col h-[420px]">
      <div className="flex items-center gap-2 border-b border-slate-700/60 px-4 py-3">
        <MessageCircle className="h-4 w-4 text-cyan-400" />
        <span className="font-medium text-white text-sm">Alert Enquiry Chat</span>
        {selectedAlertId && (
          <span className="text-xs text-emerald-400 ml-auto">Alert context active</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 scroll-panel">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <Bot className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
            )}
            <div
              className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${
                msg.role === "user"
                  ? "bg-cyan-600/20 text-cyan-100"
                  : "bg-slate-800/80 text-slate-300"
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

      <form onSubmit={handleSend} className="border-t border-slate-700/60 p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this alert or the pipeline…"
          className="flex-1 rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-3 py-2 text-white transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
