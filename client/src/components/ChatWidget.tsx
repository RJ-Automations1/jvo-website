/*
 * Floating visitor chatbot. A black launcher in the bottom-right opens an
 * on-brand monochrome panel that talks to POST /api/chat, which answers from the
 * JVO capability overview (server/jvoKnowledge.ts). Self-contained — no external
 * chat library, and no API key ever reaches the browser.
 */
import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING =
  "Hi! I'm the JVO assistant. Ask me about memberships, virtual mail, office and meeting space, pricing, or how to get started. How can I help?";

const OFFLINE_REPLY =
  "I couldn't reach our assistant. Please email jonesborovirtualoffice@gmail.com or call 678-519-4723 and we'll help you directly.";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes the panel, matching the rest of the site's dialogs.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Skip the canned greeting; send only the real conversation.
        body: JSON.stringify({
          messages: next.filter((m, i) => !(i === 0 && m.role === "assistant")),
        }),
      });
      const data = await res.json().catch(() => ({}));
      setMessages((m) => [...m, { role: "assistant", content: data.reply || OFFLINE_REPLY }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: OFFLINE_REPLY }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        aria-label={open ? "Close chat" : "Chat with Jonesboro Virtual Office"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-black text-white shadow-[0_8px_24px_rgba(0,0,0,0.28)] transition-transform hover:scale-105"
      >
        {open ? <X size={22} strokeWidth={2} /> : <MessageCircle size={24} strokeWidth={1.75} />}
      </button>

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Jonesboro Virtual Office chat"
          className="fixed bottom-24 right-5 z-[60] flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-[0_16px_48px_rgba(0,0,0,0.22)]"
          style={{
            width: "min(380px, calc(100vw - 2.5rem))",
            height: "min(560px, calc(100vh - 8.5rem))",
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-black/10 bg-[#0A0A0A] px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white font-display text-base font-semibold text-black">
              J
            </span>
            <div>
              <div className="font-display text-base font-semibold leading-tight text-white">
                JVO Assistant
              </div>
              <div className="font-sans text-[0.7rem] text-white/45">
                Memberships, mail, space &amp; pricing
              </div>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-[#FAFAFA] px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] whitespace-pre-wrap rounded-lg px-3 py-2 font-sans text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-black text-white"
                      : "border border-black/10 bg-white text-black/80"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-lg border border-black/10 bg-white px-3 py-2 font-sans text-sm text-black/40">
                  Typing…
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="flex items-center gap-2 border-t border-black/10 bg-white px-3 py-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type your question…"
              aria-label="Your message"
              className="flex-1 rounded-lg border border-black/15 bg-white px-3 py-2 font-sans text-sm text-black outline-none placeholder:text-black/35 focus:border-black/40"
            />
            <button
              type="button"
              onClick={send}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black text-white transition-opacity disabled:cursor-default disabled:opacity-40"
            >
              <Send size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
