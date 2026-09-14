import { useEffect, useState, type ReactNode } from "react";

type Toast = { id: number; text: string; kind: "ok" | "err" | "info" };

let pushImpl: ((text: string, kind?: Toast["kind"]) => void) | null = null;

export function toast(text: string, kind: Toast["kind"] = "ok") {
  pushImpl?.(text, kind);
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    pushImpl = (text, kind = "ok") => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, text, kind }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
    };
    return () => {
      pushImpl = null;
    };
  }, []);
  return (
    <>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-20 z-50 flex flex-col gap-2 md:inset-x-auto md:right-4 md:bottom-4 md:w-80">
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-2xl border px-4 py-3 text-sm shadow-xl ${
              t.kind === "err"
                ? "border-rose-400/30 bg-ink-800 text-rose-400"
                : t.kind === "info"
                  ? "border-sage-400/30 bg-ink-800 text-cream-50"
                  : "border-gold-400/30 bg-ink-800 text-gold-400"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
