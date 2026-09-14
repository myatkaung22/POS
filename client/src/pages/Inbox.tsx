import { useEffect, useState } from "react";
import { api } from "../api";
import { getSocket } from "../socket";
import type { InboxMessage } from "../types";
import { useAuth } from "../auth";

export function InboxPage() {
  const { setUnread } = useAuth();
  const [messages, setMessages] = useState<InboxMessage[]>([]);

  async function load() {
    const rows = await api<InboxMessage[]>("/api/inbox");
    setMessages(rows);
    setUnread(rows.filter((m) => !m.read).length);
  }

  useEffect(() => {
    void load();
    const socket = getSocket();
    socket.on("inbox:new", load);
    return () => {
      socket.off("inbox:new", load);
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex justify-end">
        <button
          onClick={async () => {
            await api("/api/inbox/read-all", { method: "POST" });
            void load();
          }}
          className="rounded-2xl bg-white/5 px-4 py-2 text-sm"
        >
          Mark all read
        </button>
      </div>
      {messages.map((m) => (
        <button
          key={m.id}
          onClick={async () => {
            if (!m.read) await api(`/api/inbox/${m.id}/read`, { method: "POST" });
            void load();
          }}
          className={`w-full rounded-[24px] border p-4 text-left ${m.read ? "border-white/5 bg-ink-900" : "border-gold-400/30 bg-gold-500/10"}`}
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="display min-w-0 text-lg">{m.title}</div>
            <span className="text-xs uppercase text-sage-400">{m.type.replace("_", " ")}</span>
          </div>
          <p className="mt-1 text-sm text-cream-100/70">{m.body}</p>
          <div className="mt-2 text-xs text-cream-100/40">{new Date(m.createdAt).toLocaleString()}</div>
        </button>
      ))}
    </div>
  );
}
