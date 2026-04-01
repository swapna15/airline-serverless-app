"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; text: string };
type QuotaInfo = {
  today: { inputTokens: number; outputTokens: number; totalTokens: number };
  quota: { tokensPerMinute: number | null };
  error?: string;
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! I'm your AirApp flight assistant. I can search flights, check seat availability, and book seats for you. What can I help you with?" },
  ]);
  const [history, setHistory] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [showQuota, setShowQuota] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function fetchQuota() {
    try {
      const res = await fetch("/api/bedrock-quota");
      const data = await res.json();
      setQuota(data);
    } catch {
      setQuota({ today: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, quota: { tokensPerMinute: null }, error: "Could not fetch quota" });
    }
  }

  useEffect(() => {
    if (open && showQuota && !quota) fetchQuota();
  }, [open, showQuota]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      const reply = data.reply ?? "Sorry, something went wrong.";
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      setHistory((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: reply },
      ]);
      // Refresh quota after each message
      if (showQuota) fetchQuota();
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg text-2xl transition"
        aria-label="Open flight assistant"
      >
        {open ? "✕" : "✈"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200">
          {/* Header */}
          <div className="bg-blue-600 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-white text-lg">✈</span>
              <div>
                <p className="text-white font-semibold text-sm">AirApp Assistant</p>
                <p className="text-blue-200 text-xs">Claude Sonnet 4.6 · 1M context</p>
              </div>
            </div>
            <button
              onClick={() => { setShowQuota((s) => !s); if (!quota) fetchQuota(); }}
              className="text-blue-200 hover:text-white text-xs underline transition"
              title="View token usage"
            >
              {showQuota ? "Hide quota" : "View quota"}
            </button>
          </div>

          {/* Quota panel */}
          {showQuota && (
            <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 text-xs text-gray-700">
              {!quota ? (
                <span className="text-gray-400 animate-pulse">Loading quota...</span>
              ) : quota.error ? (
                <span className="text-red-500">{quota.error}</span>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Tokens used today</span>
                    <span className="font-semibold text-gray-800">{quota.today.totalTokens.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Input tokens</span>
                    <span className="text-gray-700">{quota.today.inputTokens.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Output tokens</span>
                    <span className="text-gray-700">{quota.today.outputTokens.toLocaleString()}</span>
                  </div>
                  {quota.quota.tokensPerMinute !== null && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Rate limit</span>
                      <span className="text-gray-700">{quota.quota.tokensPerMinute.toLocaleString()} tok/min</span>
                    </div>
                  )}
                  <button onClick={fetchQuota} className="text-blue-500 hover:underline text-right mt-1">Refresh</button>
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 max-h-72">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-xl px-3 py-2 text-sm text-gray-500 flex items-center gap-1">
                  <span className="animate-pulse">Thinking</span>
                  <span className="animate-bounce">.</span>
                  <span className="animate-bounce delay-75">.</span>
                  <span className="animate-bounce delay-150">.</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={send} className="border-t border-gray-200 p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              placeholder={loading ? "Waiting for response..." : "Ask about flights or book a seat..."}
              className="flex-1 border rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-3 py-2 rounded-lg transition"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
