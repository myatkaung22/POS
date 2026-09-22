import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Receipt, Search, UtensilsCrossed, X } from "lucide-react";
import { api } from "../api";
import { getSocket } from "../socket";
import { money, type Category, type DiningTable, type Order, type SettingsMap, DEFAULT_CURRENCY, personBills } from "../types";
import { toast } from "../components/Toast";
import { DishPhoto } from "../components/DishPhoto";

type CartLine = { menuItemId: string; name: string; price: number; qty: number; notes: string; emoji: string; diner: string };
type GuestTab = "menu" | "bill";

function guestStatus(status: string) {
  if (status === "pending") return "Waiting";
  if (status === "sent") return "Kitchen";
  if (status === "preparing") return "Cooking";
  if (status === "ready") return "Ready";
  if (status === "served") return "Served";
  if (status === "cancelled") return "Cancelled";
  return status;
}

function dinerKey(token: string) {
  return `omni-qr-diner-${token}`;
}

function GuestNameBar({
  value,
  names,
  onChange,
}: {
  value: string;
  names: string[];
  onChange: (value: string) => void;
}) {
  const active = value.trim().toLowerCase();
  return (
    <div className="mt-3">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your name (optional) — see what you owe"
        className="w-full rounded-2xl border-0 bg-white py-2.5 px-3 text-sm text-ink-950 outline-none"
      />
      {(names.length > 0 || value.trim()) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChange("")}
            className={`rounded-full px-3 py-1 text-xs ${!active ? "bg-gold-500 text-ink-950" : "bg-white/15 text-white"}`}
          >
            Table
          </button>
          {names.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              className={`rounded-full px-3 py-1 text-xs ${active === name.toLowerCase() ? "bg-gold-500 text-ink-950" : "bg-white/15 text-white"}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function QRMenuPage() {
  const { token } = useParams();
  const [table, setTable] = useState<DiningTable | null>(null);
  const [menu, setMenu] = useState<Category[]>([]);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [order, setOrder] = useState<Order | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [diner, setDiner] = useState("");
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<GuestTab>("menu");

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
    if (!token) return;
    const saved = localStorage.getItem(dinerKey(token)) || "";
    if (saved) setDiner(saved);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const name = diner.trim();
    if (name) localStorage.setItem(dinerKey(token), name);
    else localStorage.removeItem(dinerKey(token));
  }, [diner, token]);

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
    const all = menu.flatMap((c) => c.items.map((i) => ({ ...i, categoryName: c.name })));
    const byCat = cat === "all" ? all : all.filter((i) => i.categoryId === cat);
    const q = query.trim().toLowerCase();
    if (!q) return byCat;
    return byCat.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.categoryName.toLowerCase().includes(q)
    );
  }, [menu, cat, query]);
  const activeCategory = menu.find((c) => c.id === cat);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const currency = settings.currency || DEFAULT_CURRENCY;
  const decimals = Math.min(2, Math.max(0, Number(settings.billDecimals ?? 2) || 0));
  const fmt = (n: number) => money(n, currency, decimals);
  const billItems = (order?.items || []).filter((i) => i.status !== "cancelled");
  const billPeople = order ? personBills(billItems, order) : [];
  const splitDiners = billPeople.length > 1 || (billPeople.length === 1 && billPeople[0].label !== "Shared");
  const dinerNames = [...new Set(billItems.map((i) => String(i.diner || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const myBill = diner.trim() ? billPeople.find((g) => g.label.toLowerCase() === diner.trim().toLowerCase()) : undefined;
  const billed = order?.status === "billed";

  async function submit() {
    if (!cart.length) return;
    const next = await api<Order>(`/api/qr/${token}/orders`, {
      method: "POST",
      body: JSON.stringify({
        note,
        diner,
        items: cart.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty, notes: l.notes, diner: l.diner || diner })),
      }),
    });
    setOrder(next);
    setCart([]);
    setOpen(false);
    setTab("bill");
    toast("Sent — the POS has been notified");
  }

  async function callStaff() {
    await api(`/api/qr/${token}/call-staff`, { method: "POST", body: JSON.stringify({ note: "Please come to the table" }) });
    toast("Staff notified");
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
        <GuestNameBar value={diner} names={dinerNames} onChange={setDiner} />
        {tab === "bill" && myBill && (
          <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-gold-500 px-3 py-2 text-ink-950">
            <span className="text-sm">{myBill.label} owes</span>
            <span className="display text-2xl leading-none">{fmt(myBill.total)}</span>
          </div>
        )}
        {tab === "menu" && (
          <>
            <label className="relative mt-3 block text-ink-950">
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 opacity-40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dishes or category"
                className="w-full rounded-2xl border-0 bg-white py-2.5 pr-9 pl-9 text-sm text-ink-950 outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 opacity-50"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <div className="mt-2 flex gap-2 overflow-auto">
              <button onClick={() => setCat("all")} className={`rounded-full px-3 py-1 text-sm ${cat === "all" ? "bg-gold-500 text-ink-950" : "bg-white/10 text-white"}`}>
                All
              </button>
              {menu.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCat(c.id)}
                  className={`rounded-full px-3 py-1 text-sm whitespace-nowrap ${cat === c.id ? "bg-gold-500 text-ink-950" : "bg-white/10 text-white"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      {tab === "menu" && (
        <div className="space-y-3 px-4 pt-3 pb-36">
          {items.length === 0 && (
            <div className="rounded-3xl bg-white p-6 text-center text-sm opacity-60">
              No dishes match{query.trim() ? ` “${query.trim()}”` : ""}
              {activeCategory ? ` in ${activeCategory.name}` : ""}.
              {cat !== "all" && (
                <button type="button" onClick={() => setCat("all")} className="mt-3 block w-full font-medium text-ink-900">
                  Search all categories
                </button>
              )}
            </div>
          )}
          {items.map((item) => (
            <div key={item.id} className="flex gap-3 rounded-3xl bg-white p-4 shadow-sm">
              <DishPhoto item={item} className="h-16 w-16 shrink-0 rounded-2xl bg-ink-900/5 text-2xl" />
              <div className="flex-1">
                <div className="text-[10px] tracking-wide uppercase opacity-45">{item.categoryName}</div>
                <div className="font-medium">{item.name}</div>
                <div className="text-sm opacity-60">{item.description}</div>
                <div className="mt-1">{money(item.price, currency)}</div>
              </div>
              <button
                onClick={() => {
                  const tag = diner.trim();
                  setCart((prev) => {
                    const found = prev.find((l) => l.menuItemId === item.id && (l.diner || "") === tag);
                    if (found) {
                      return prev.map((l) =>
                        l.menuItemId === item.id && (l.diner || "") === tag ? { ...l, qty: l.qty + 1 } : l
                      );
                    }
                    return [
                      ...prev,
                      { menuItemId: item.id, name: item.name, price: item.price, qty: 1, notes: "", emoji: item.emoji, diner: tag },
                    ];
                  });
                }}
                className="self-center rounded-full bg-ink-900 px-3 py-1 text-cream-50"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "bill" && (
        <div className="space-y-3 px-4 pt-3 pb-36">
          {!order || billItems.length === 0 ? (
            <div className="rounded-3xl bg-white p-6 text-center text-sm opacity-60">
              No bill yet. Add your name, then send dishes from the menu.
              {cartCount > 0 && <div className="mt-2 font-medium text-ink-900">{cartCount} item{cartCount === 1 ? "" : "s"} in your cart, not sent.</div>}
            </div>
          ) : (
            <>
              <div className="rounded-3xl bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] tracking-[0.18em] uppercase opacity-45">Table {table.number}</div>
                    <div className="display text-2xl">Total bill</div>
                    <div className="text-sm opacity-55">Ticket #{order.orderNo}{billed ? " · please pay at the counter" : ""}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] tracking-wide uppercase opacity-45">Table due</div>
                    <div className="display text-2xl">{fmt(order.total)}</div>
                  </div>
                </div>
              </div>
              {splitDiners ? (
                <div className="rounded-3xl bg-ink-900 p-4 text-cream-50 shadow-sm">
                  <div className="text-[10px] tracking-[0.18em] uppercase text-white/45">Each person</div>
                  <div className="mt-2 space-y-2">
                    {billPeople.map((group) => (
                      <button
                        type="button"
                        key={group.label}
                        onClick={() => setDiner(group.label === "Shared" ? "" : group.label)}
                        className={`flex w-full items-baseline justify-between rounded-2xl px-3 py-2 text-left ${
                          myBill?.label === group.label ? "bg-gold-500 text-ink-950" : "bg-white/8"
                        }`}
                      >
                        <span className="text-lg">{group.label}</span>
                        <span className="display text-2xl leading-none">{fmt(group.total)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl bg-white p-4 text-sm shadow-sm opacity-70">
                  Put your name at the top, then order, so each person can see what they owe on this tab.
                </div>
              )}
              {billPeople.map((group) => (
                <div key={group.label} className="rounded-3xl bg-white p-4 shadow-sm">
                  {splitDiners && (
                    <div className="flex items-baseline justify-between">
                      <div className="text-[10px] tracking-[0.18em] uppercase opacity-45">{group.label}</div>
                      <div className="text-xs opacity-45">{group.items.reduce((n, i) => n + i.qty, 0)} item{group.items.reduce((n, i) => n + i.qty, 0) === 1 ? "" : "s"}</div>
                    </div>
                  )}
                  <div className={splitDiners ? "mt-2 divide-y divide-ink-900/10" : "divide-y divide-ink-900/10"}>
                    {group.items.map((i) => (
                      <div key={i.id} className={`flex items-start justify-between gap-3 py-2.5 text-sm ${i.status === "cancelled" ? "opacity-40 line-through" : ""}`}>
                        <div>
                          <div>
                            {i.qty}× {i.name}
                          </div>
                          {!splitDiners && i.diner ? <div className="text-xs opacity-50">{i.diner}</div> : null}
                          {i.notes && <div className="text-xs opacity-50">{i.notes}</div>}
                          <div className="text-[11px] tracking-wide uppercase opacity-45">{guestStatus(i.status)}</div>
                        </div>
                        <div className="shrink-0">{fmt(i.price * i.qty)}</div>
                      </div>
                    ))}
                  </div>
                  {splitDiners && (
                    <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-ink-900 px-3 py-2 text-cream-50">
                      <span>{group.label} total</span>
                      <span className="display text-2xl leading-none">{fmt(group.total)}</span>
                    </div>
                  )}
                </div>
              ))}
              <div className="rounded-3xl bg-white p-4 shadow-sm">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between opacity-70">
                    <span>Subtotal</span>
                    <span>{fmt(order.subtotal)}</span>
                  </div>
                  {Boolean(order.discountAmount) && (
                    <div className="flex justify-between opacity-70">
                      <span>Discount</span>
                      <span>-{fmt(order.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between opacity-70">
                    <span>Tax {order.taxRate || 0}%</span>
                    <span>{fmt(order.taxAmount)}</span>
                  </div>
                  {Boolean(order.serviceAmount) && (
                    <div className="flex justify-between opacity-70">
                      <span>Service</span>
                      <span>{fmt(order.serviceAmount)}</span>
                    </div>
                  )}
                  {Boolean(order.roundAmount) && (
                    <div className="flex justify-between opacity-70">
                      <span>{(order.roundAmount || 0) > 0 ? "Round up" : "Round down"}</span>
                      <span>{fmt(order.roundAmount || 0)}</span>
                    </div>
                  )}
                  {splitDiners &&
                    billPeople.map((group) => (
                      <div key={group.label} className="flex justify-between">
                        <span>{group.label}</span>
                        <span>{fmt(group.total)}</span>
                      </div>
                    ))}
                  <div className="flex justify-between pt-1 text-base font-medium">
                    <span>Table total</span>
                    <span>{fmt(order.total)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
          {cartCount > 0 && order && (
            <button type="button" onClick={() => setTab("menu")} className="w-full text-center text-sm opacity-60">
              {cartCount} more in cart — go back to menu to send
            </button>
          )}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 bg-cream-50/95 pt-2 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {tab === "menu" && (
          <div className="flex gap-2 px-4 pb-2">
            <button onClick={() => void callStaff()} className="rounded-2xl bg-white px-4 py-3 text-sm shadow">
              Call staff
            </button>
            <button onClick={() => setOpen(true)} className="flex-1 rounded-2xl bg-ink-900 py-3 text-cream-50">
              Cart · {cartCount} · {fmt(total)}
            </button>
          </div>
        )}
        {tab === "bill" && (
          <div className="px-4 pb-2">
            <button onClick={() => void callStaff()} className="w-full rounded-2xl bg-white py-3 text-sm shadow">
              Call staff
            </button>
          </div>
        )}
        <nav className="grid grid-cols-2 border-t border-ink-900/10">
          <button
            type="button"
            onClick={() => setTab("menu")}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] ${tab === "menu" ? "text-ink-950" : "text-ink-950/40"}`}
          >
            <UtensilsCrossed size={18} />
            Menu
            {cartCount > 0 && <span className="sr-only">{cartCount} in cart</span>}
          </button>
          <button
            type="button"
            onClick={() => setTab("bill")}
            className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] ${tab === "bill" ? "text-ink-950" : "text-ink-950/40"}`}
          >
            <Receipt size={18} />
            Total bill
            {order && billItems.length > 0 && (
              <span className="absolute top-1.5 right-[22%] h-1.5 w-1.5 rounded-full bg-ink-900" />
            )}
          </button>
        </nav>
      </div>

      {open && (
        <div className="fixed inset-0 z-20 bg-black/40 p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="ml-auto h-full w-full max-w-md overflow-auto rounded-none bg-cream-50 p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="display text-2xl">Your order</div>
            {cart.map((l, idx) => (
              <div key={`${l.menuItemId}-${l.diner}-${idx}`} className="mt-3 flex items-center justify-between">
                <div>
                  {l.emoji} {l.name}
                  {l.diner ? <div className="text-xs opacity-50">{l.diner}</div> : null}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCart((p) => p.map((x, i) => (i === idx ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>−</button>
                  {l.qty}
                  <button onClick={() => setCart((p) => p.map((x, i) => (i === idx ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                </div>
              </div>
            ))}
            <input
              className="mt-4 w-full rounded-2xl border p-3"
              placeholder="Your name (optional)"
              value={diner}
              onChange={(e) => setDiner(e.target.value)}
            />
            <textarea
              className="mt-3 w-full rounded-2xl border p-3"
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
