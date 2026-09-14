import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus, QrCode, Trash2, X } from "lucide-react";
import { api } from "../api";
import { getSocket } from "../socket";
import type { DiningTable } from "../types";
import { money } from "../types";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";
import { useQrAlerts } from "../alerts";

function tableTone(table: DiningTable) {
  const open = table.orders?.[0];
  const guest = Boolean(open?.type === "qr" && open.items?.some((i) => i.status === "pending"));
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

type TableForm = { number: string; name: string; seats: string };

export function TablesPage() {
  const { settings, can } = useAuth();
  const { alerts } = useQrAlerts();
  const navigate = useNavigate();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [qr, setQr] = useState<{ table: DiningTable; dataUrl: string; url: string } | null>(null);
  const [editor, setEditor] = useState<{ table: DiningTable | null; form: TableForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = can("settings");

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

  const grouped = useMemo(() => {
    const used = new Set<string>();
    const sections = zones
      .map((zone) => {
        const rows = tables.filter((t) => zone.match(t.number));
        rows.forEach((t) => used.add(t.id));
        return { name: zone.name, rows };
      })
      .filter((s) => s.rows.length);
    const other = tables.filter((t) => !used.has(t.id));
    if (other.length) sections.push({ name: "Other", rows: other });
    return sections;
  }, [tables]);

  async function openQr(table: DiningTable, e?: MouseEvent) {
    e?.stopPropagation();
    const data = await api<{ table: DiningTable; dataUrl: string; url: string }>(`/api/tables/${table.id}/qr`);
    setQr(data);
  }

  function startCreate() {
    const next = (tables.reduce((m, t) => Math.max(m, t.number), 0) || 0) + 1;
    setEditor({
      table: null,
      form: { number: String(next), name: `Table ${next}`, seats: "4" },
    });
  }

  function startEdit(table: DiningTable, e: MouseEvent) {
    e.stopPropagation();
    setEditor({
      table,
      form: { number: String(table.number), name: table.name, seats: String(table.seats) },
    });
  }

  async function saveTable() {
    if (!editor) return;
    const number = Number(editor.form.number);
    const seats = Number(editor.form.seats);
    if (!Number.isInteger(number) || number < 1) return toast("Enter a table number", "err");
    if (!editor.form.name.trim()) return toast("Enter a table name", "err");
    if (!Number.isFinite(seats) || seats < 1) return toast("Enter seats", "err");
    setSaving(true);
    try {
      if (editor.table) {
        await api(`/api/tables/${editor.table.id}`, {
          method: "PATCH",
          body: JSON.stringify({ number, name: editor.form.name.trim(), seats }),
        });
        toast(`Table ${number} updated`);
      } else {
        await api("/api/tables", {
          method: "POST",
          body: JSON.stringify({ number, name: editor.form.name.trim(), seats }),
        });
        toast(`Table ${number} added`);
      }
      setEditor(null);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "err");
    } finally {
      setSaving(false);
    }
  }

  async function removeTable(table: DiningTable, e: MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Remove table ${table.number} ${table.name}?`)) return;
    try {
      await api(`/api/tables/${table.id}`, { method: "DELETE" });
      toast(`Table ${table.number} removed`);
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove table", "err");
    }
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
          {canManage && (
            <button
              type="button"
              onClick={startCreate}
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
        {grouped.map((zone) => (
          <div key={zone.name}>
            <div className="mb-2 text-[11px] tracking-[0.18em] text-cream-100/40 uppercase">{zone.name}</div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {zone.rows.map((table) => {
                const tone = tableTone(table);
                const open = table.orders?.[0];
                return (
                  <div
                    key={table.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/pos?table=${table.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") navigate(`/pos?table=${table.id}`);
                    }}
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
                        <span>Tap to open</span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={(e) => void openQr(table, e)}
                        className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-1 text-[11px]"
                      >
                        <QrCode size={12} /> QR
                      </button>
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => startEdit(table, e)}
                            className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-1 text-[11px]"
                          >
                            <Pencil size={12} /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={(e) => void removeTable(table, e)}
                            className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-1 text-[11px] text-rose-300"
                          >
                            <Trash2 size={12} /> Remove
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editor && (
        <div className="fixed inset-0 z-[60] grid place-items-end bg-black/65 p-3 sm:place-items-center sm:p-4" onClick={() => setEditor(null)}>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="display text-2xl">{editor.table ? `Edit table ${editor.table.number}` : "Add table"}</div>
              <button type="button" onClick={() => setEditor(null)} className="rounded-full p-1 text-cream-100/50" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2">
              <label className="block text-sm">
                <span className="text-sage-400">Number</span>
                <input
                  className="mt-1 w-full rounded-2xl bg-ink-800 px-3 py-2"
                  value={editor.form.number}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, number: e.target.value.replace(/[^\d]/g, "") } })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-sage-400">Name</span>
                <input
                  className="mt-1 w-full rounded-2xl bg-ink-800 px-3 py-2"
                  value={editor.form.name}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, name: e.target.value } })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-sage-400">Seats</span>
                <input
                  className="mt-1 w-full rounded-2xl bg-ink-800 px-3 py-2"
                  value={editor.form.seats}
                  onChange={(e) => setEditor({ ...editor, form: { ...editor.form, seats: e.target.value.replace(/[^\d]/g, "") } })}
                />
              </label>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveTable()}
                className="w-full rounded-2xl bg-gold-500 py-2.5 font-medium text-ink-950 disabled:opacity-50"
              >
                {saving ? "Saving…" : editor.table ? "Save changes" : "Add table"}
              </button>
              <button type="button" onClick={() => setEditor(null)} className="w-full rounded-2xl bg-white/5 py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
