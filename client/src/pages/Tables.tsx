import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { QrCode, Plus } from "lucide-react";
import { api } from "../api";
import { getSocket } from "../socket";
import type { DiningTable } from "../types";
import { money } from "../types";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";
import { useQrAlerts } from "../alerts";

function tableTone(table: DiningTable) {
  const open = table.orders?.[0];
  const guest = Boolean(open?.items.some((i) => i.status === "pending"));
  if (guest) return "guest" as const;
  if (table.status === "billing") return "billing" as const;
  if (table.status === "occupied") return "seated" as const;
  if (table.status === "reserved") return "reserved" as const;
  return "free" as const;
}

const toneClass = {
  free: "border-sage-400/25 bg-sage-500/8 text-sage-400",
  seated: "border-gold-400/35 bg-gold-500/10 text-gold-400",
  guest: "pulse-ring border-sky-400/50 bg-sky-400/12 text-sky-300",
  billing: "border-rose-400/40 bg-rose-400/10 text-rose-400",
  reserved: "border-white/15 bg-white/5 text-cream-100/70",
};

const toneLabel = {
  free: "Free",
  seated: "Seated",
  guest: "Guest order",
  billing: "Check",
  reserved: "Hold",
};

const zones = [
  { name: "Window", match: (n: number) => n <= 2 },
  { name: "Lounge", match: (n: number) => n >= 3 && n <= 4 },
  { name: "Booths", match: (n: number) => n >= 5 && n <= 6 },
  { name: "Patio", match: (n: number) => n >= 7 && n <= 8 },
  { name: "Center", match: (n: number) => n >= 9 && n <= 10 },
  { name: "Bar", match: (n: number) => n >= 11 && n <= 12 },
  { name: "Private", match: (n: number) => n >= 13 },
];

export function TablesPage() {
  const { settings, can } = useAuth();
  const { alerts } = useQrAlerts();
  const navigate = useNavigate();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [qr, setQr] = useState<{ table: DiningTable; dataUrl: string; url: string } | null>(null);

  async function load() {
    setTables(await api<DiningTable[]>("/api/tables"));
  }

  useEffect(() => {
    void load();
    const socket = getSocket();
    socket.on("table:updated", load);
    socket.on("order:updated", load);
    socket.on("pos:qr-order", load);
    return () => {
      socket.off("table:updated", load);
      socket.off("order:updated", load);
      socket.off("pos:qr-order", load);
    };
  }, []);

  const counts = useMemo(() => {
    const list = tables.map(tableTone);
    return {
      free: list.filter((t) => t === "free").length,
      seated: list.filter((t) => t === "seated").length,
      guest: list.filter((t) => t === "guest").length,
    };
  }, [tables]);

  async function openQr(table: DiningTable, e?: MouseEvent) {
    e?.stopPropagation();
    const data = await api<{ table: DiningTable; dataUrl: string; url: string }>(`/api/tables/${table.id}/qr`);
    setQr(data);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full border px-3 py-1 ${toneClass.free}`}>{counts.free} free</span>
          <span className={`rounded-full border px-3 py-1 ${toneClass.seated}`}>{counts.seated} seated</span>
          <span className={`rounded-full border px-3 py-1 ${toneClass.guest}`}>{counts.guest} guest orders</span>
        </div>
        <div className="flex gap-2">
          {can("pos") && (
            <>
              <button onClick={() => navigate("/pos?type=takeaway")} className="rounded-2xl border border-white/10 px-4 py-2 text-sm">
                Takeaway
              </button>
              <button onClick={() => navigate("/pos?type=delivery")} className="rounded-2xl border border-white/10 px-4 py-2 text-sm">
                Delivery
              </button>
              <button onClick={() => navigate("/dispatch")} className="rounded-2xl bg-gold-500 px-4 py-2 text-sm text-ink-950">
                Pickup board
              </button>
            </>
          )}
          {can("settings") && (
            <button
              onClick={async () => {
                await api("/api/tables", { method: "POST", body: JSON.stringify({}) });
                toast("Table added");
                void load();
              }}
              className="inline-flex items-center gap-2 rounded-2xl bg-gold-500 px-4 py-2 text-sm text-ink-950"
            >
              <Plus size={16} /> Add table
            </button>
          )}
        </div>
      </div>

      {alerts[0] && (
        <button
          onClick={() => navigate(`/pos?table=${alerts[0].tableId}`)}
          className="flex w-full flex-col items-start gap-2 rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="text-sky-300">
            Latest guest order · Table {alerts[0].tableNumber} · {alerts[0].items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
          </span>
          <span className="rounded-full bg-sky-400 px-3 py-1 text-xs font-semibold text-ink-950">Open POS</span>
        </button>
      )}

      <div className="space-y-6 rounded-[28px] border border-white/8 bg-ink-900 p-3 sm:p-5">
        {zones.map((zone) => {
          const rows = tables.filter((t) => zone.match(t.number));
          if (!rows.length) return null;
          return (
            <div key={zone.name}>
              <div className="mb-2 text-[11px] tracking-[0.18em] text-cream-100/40 uppercase">{zone.name}</div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {rows.map((table) => {
                  const tone = tableTone(table);
                  const open = table.orders?.[0];
                  return (
                    <button
                      key={table.id}
                      onClick={() => navigate(`/pos?table=${table.id}`)}
                      className={`rounded-[24px] border p-4 text-left transition hover:-translate-y-0.5 ${toneClass[tone]}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-xs opacity-70">{table.name}</div>
                          <div className="display text-4xl leading-none">{table.number}</div>
                        </div>
                        <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] tracking-wide uppercase">
                          {toneLabel[tone]}
                        </span>
                      </div>
                      <div className="mt-3 flex items-end justify-between text-xs opacity-80">
                        <span>{table.seats} seats</span>
                        {open ? (
                          <span>
                            #{open.orderNo} · {money(open.total, settings.currency)}
                          </span>
                        ) : (
                          <span>Tap to seat</span>
                        )}
                      </div>
                      <div
                        role="button"
                        onClick={(e) => void openQr(table, e)}
                        className="mt-3 inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-1 text-[11px]"
                      >
                        <QrCode size={12} /> QR
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {qr && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={() => setQr(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-cream-50 p-6 text-ink-950" onClick={(e) => e.stopPropagation()}>
            <div className="display text-2xl">{qr.table.name}</div>
            <p className="text-sm opacity-70">Guest menu · Table {qr.table.number}</p>
            <img src={qr.dataUrl} alt="QR" className="mx-auto my-4 w-56" />
            <p className="break-all text-center text-xs opacity-60">{qr.url}</p>
            <button onClick={() => setQr(null)} className="mt-4 w-full rounded-2xl bg-ink-900 py-2 text-cream-50">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
