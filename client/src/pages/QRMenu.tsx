import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { getSocket } from "../socket";
import { money, type Category, type DiningTable, type Order, type SettingsMap, DEFAULT_CURRENCY } from "../types";
import { toast } from "../components/Toast";
import { DishPhoto } from "../components/DishPhoto";

type CartLine = { menuItemId: string; name: string; price: number; qty: number; notes: string; emoji: string };

export function QRMenuPage() {
  const { token } = useParams();
  const [table, setTable] = useState<DiningTable | null>(null);
  const [menu, setMenu] = useState<Category[]>([]);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [order, setOrder] = useState<Order | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState(false);

  async function load() {
    const data = await api<{ table: DiningTable; menu: Category[]; settings: SettingsMap; order: Order | null }>(
      `/api/qr/${token}`
    );
    setTable(data.table);
    setMenu(data.menu);
    setSettings(data.settings);
    setOrder(data.order);
  }

  useEffect(() => {
    void load().catch(() => toast("This table QR is invalid", "err"));
  }, [token]);

  useEffect(() => {
    const socket = getSocket();
    const onOrder = (next: Order) => {
      if (next.tableId && next.tableId === table?.id) setOrder(next);
    };
    socket.on("order:updated", onOrder);
    return () => {
      socket.off("order:updated", onOrder);
    };
  }, [table?.id]);

  const items = useMemo(() => {
    const all = menu.flatMap((c) => c.items);
    return cat === "all" ? all : all.filter((i) => i.categoryId === cat);
  }, [menu, cat]);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const currency = settings.currency || DEFAULT_CURRENCY;

  async function submit() {
    if (!cart.length) return;
    const next = await api<Order>(`/api/qr/${token}/orders`, {
      method: "POST",
      body: JSON.stringify({
        note,
        items: cart.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty, notes: l.notes })),
      }),
    });
    setOrder(next);
    setCart([]);
    setOpen(false);
    toast("Sent — the POS has been notified");
  }

  if (!table) {
    return <div className="grid min-h-screen place-items-center bg-cream-50 text-ink-950">Opening guest menu…</div>;
  }

  return (
    <div className="min-h-screen bg-cream-50 text-ink-950">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-black px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <img src="/logo.png" alt="4 Corner" className="h-10 w-auto object-contain" />
        <div className="mt-1 text-[10px] font-semibold tracking-[0.22em] text-white/40 uppercase">OmniMind POS</div>
        <div className="display mt-2 text-2xl">{table.name}</div>
        <div className="text-sm text-white/55">Table {table.number} · order from your phone</div>
      </header>
      <div className="flex gap-2 overflow-auto px-4 py-3">
        <button onClick={() => setCat("all")} className={`rounded-full px-3 py-1 text-sm ${cat === "all" ? "bg-ink-900 text-cream-50" : "bg-white"}`}>
          All
        </button>
        {menu.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={`rounded-full px-3 py-1 text-sm whitespace-nowrap ${cat === c.id ? "bg-ink-900 text-cream-50" : "bg-white"}`}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="space-y-3 px-4 pb-32">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3 rounded-3xl bg-white p-4 shadow-sm">
            <DishPhoto item={item} className="h-16 w-16 shrink-0 rounded-2xl bg-ink-900/5 text-2xl" />
            <div className="flex-1">
              <div className="font-medium">{item.name}</div>
              <div className="text-sm opacity-60">{item.description}</div>
              <div className="mt-1">{money(item.price, currency)}</div>
            </div>
            <button
              onClick={() => {
                setCart((prev) => {
                  const found = prev.find((l) => l.menuItemId === item.id);
                  if (found) return prev.map((l) => (l.menuItemId === item.id ? { ...l, qty: l.qty + 1 } : l));
                  return [...prev, { menuItemId: item.id, name: item.name, price: item.price, qty: 1, notes: "", emoji: item.emoji }];
                });
              }}
              className="self-center rounded-full bg-ink-900 px-3 py-1 text-cream-50"
            >
              Add
            </button>
          </div>
        ))}
        {order && (
          <div className="rounded-3xl border border-ink-900/10 bg-white p-4">
            <div className="font-medium">Live table ticket #{order.orderNo}</div>
            {order.items.map((i) => (
              <div key={i.id} className="flex justify-between text-sm">
                <span>
                  {i.qty}× {i.name}
                </span>
                <span className="capitalize opacity-60">{i.status}</span>
              </div>
            ))}
            <div className="mt-2 font-medium">Total {money(order.total, currency)}</div>
          </div>
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-cream-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          <button
            onClick={async () => {
              await api(`/api/qr/${token}/call-staff`, { method: "POST", body: JSON.stringify({ note: "Please come to the table" }) });
              toast("Staff notified");
            }}
            className="rounded-2xl bg-white px-4 py-3 text-sm shadow"
          >
            Call staff
          </button>
          <button onClick={() => setOpen(true)} className="flex-1 rounded-2xl bg-ink-900 py-3 text-cream-50">
            Cart · {cart.reduce((n, l) => n + l.qty, 0)} · {money(total, currency)}
          </button>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-20 bg-black/40 p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="ml-auto h-full w-full max-w-md overflow-auto rounded-none bg-cream-50 p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="display text-2xl">Your order</div>
            {cart.map((l) => (
              <div key={l.menuItemId} className="mt-3 flex items-center justify-between">
                <div>
                  {l.emoji} {l.name}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCart((p) => p.map((x) => (x.menuItemId === l.menuItemId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>−</button>
                  {l.qty}
                  <button onClick={() => setCart((p) => p.map((x) => (x.menuItemId === l.menuItemId ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                </div>
              </div>
            ))}
            <textarea
              className="mt-4 w-full rounded-2xl border p-3"
              placeholder="Allergies or notes"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button onClick={() => void submit()} className="mt-4 w-full rounded-2xl bg-ink-900 py-3 text-cream-50">
              Send to the restaurant
            </button>
            <p className="mt-2 text-center text-xs opacity-50">Staff will see this instantly on the POS.</p>
          </div>
        </div>
      )}
    </div>
  );
}
