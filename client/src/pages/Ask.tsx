import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send, Sparkles } from "lucide-react";
import { api } from "../api";
import { toast } from "../components/Toast";

type ChatTurn = { role: "user" | "assistant"; content: string; source?: string };

const SUGGESTIONS = ["Today total sale", "How many orders today?", "This month sales", "Top selling items", "Best category today"];

function sourceLabel(source?: string) {
  if (source === "groq") return "Groq";
  if (source === "pollinations") return "Free hosted AI";
  if (source === "local") return "POS totals";
  return "";
}

export function AskPage() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const nextTurns = [...turns, { role: "user" as const, content: q }];
    setTurns(nextTurns);
    setBusy(true);
    try {
      const data = await api<{ answer: string; source: string }>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          history: turns.slice(-8).map(({ role, content }) => ({ role, content })),
        }),
      });
      setTurns((prev) => [...prev, { role: "assistant", content: data.answer, source: data.source }]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Ask failed", "err");
      setTurns((prev) => prev.slice(0, -1));
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] max-w-3xl flex-col md:min-h-[calc(100dvh-6rem)]">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto pb-3">
        {turns.length === 0 && (
          <div className="rounded-[28px] border border-white/10 bg-ink-900 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-gold-400">
              <Sparkles size={18} />
              <span className="text-xs tracking-[0.18em] uppercase">Ask OmniMind</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-full border border-white/10 bg-ink-800 px-3 py-1.5 text-sm text-cream-100/80 hover:border-gold-500/40 hover:text-gold-400"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={`${t.role}-${i}`} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[90%] rounded-3xl px-4 py-3 text-sm leading-relaxed ${
                t.role === "user" ? "bg-gold-500 text-ink-950" : "border border-white/10 bg-ink-900 text-cream-50"
              }`}
            >
              {t.content}
              {t.role === "assistant" && t.source && (
                <div className="mt-2 text-[10px] tracking-[0.16em] text-sage-400 uppercase">{sourceLabel(t.source)}</div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-sage-400">Looking up totals…</div>}
        <div ref={bottom} />
      </div>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Today total sale…"
          className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-ink-800 px-4 py-3 text-sm outline-none focus:border-gold-500/50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center gap-2 rounded-2xl bg-gold-500 px-4 py-3 text-sm font-medium text-ink-950 disabled:opacity-50"
        >
          <Send size={16} />
          Ask
        </button>
      </form>
    </div>
  );
}
