import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Banknote, Check, Minus, Plus, Printer, Receipt, Search, Send, Table2, Trash2, X } from "lucide-react";
import { api } from "../api";
import { getSocket } from "../socket";
import { useAuth } from "../auth";
import { toast } from "../components/Toast";
import { useQrAlerts } from "../alerts";
import { money, DEFAULT_CURRENCY, type Category, type DiningTable, type Order, type Promotion, personBills } from "../types";
import { DishPhoto } from "../components/DishPhoto";
import { printSlip } from "../printSlip";
import { useActionQueue } from "../actionQueue";

function isServedItem(status: string) {
  return status === "served" || status === "cancelled";
}

function itemKitchenLabel(status: string) {
  if (status === "pending") return "new";
  if (status === "sent") return "in kitchen";
  if (status === "preparing") return "cooking";
  if (status === "ready") return "ready";
  if (status === "served") return "served";
  if (status === "cancelled") return "cancelled";
  return status;
}

function canServeItem(status: string) {
  return ["sent", "preparing", "ready"].includes(status);
}

function DinerPicker({
  value,
  names,
  disabled,
  onChange,
}: {
  value: string;
  names: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const active = value.trim().toLowerCase();
  return (
    <div>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Name (optional) — who is this for?"
        className="w-full rounded-xl bg-ink-800 px-3 py-2 text-sm outline-none placeholder:text-cream-100/35"
      />
      {(names.length > 0 || value.trim()) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange("")}
            className={`rounded-full px-2.5 py-1 text-[11px] ${!active ? "bg-gold-500 text-ink-950" : "bg-white/8 text-cream-100/70"}`}
          >
            Shared
          </button>
          {names.map((name) => (
            <button
              key={name}
              type="button"
              disabled={disabled}
              onClick={() => onChange(name)}
              className={`rounded-full px-2.5 py-1 text-[11px] ${active === name.toLowerCase() ? "bg-gold-500 text-ink-950" : "bg-white/8 text-cream-100/70"}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PosPage() {
  const { settings, can } = useAuth();
  const { alerts, dismiss } = useQrAlerts();
  const { busy, run } = useActionQueue();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [menu, setMenu] = useState<Category[]>([]);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [categoryId, setCategoryId] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [diner, setDiner] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payLines, setPayLines] = useState<{ method: string; amount: string }[]>([{ method: "cash", amount: "" }]);
  const [tender, setTender] = useState("");
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState("0");
  const [promoId, setPromoId] = useState("");
  const [paid, setPaid] = useState<Order | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestAddress, setGuestAddress] = useState("");
  const [posTab, setPosTab] = useState<"tables" | "check" | "bill">("tables");

  const tableId = params.get("table") || "";
  const type = params.get("type") || "";
  const existingId = params.get("order") || "";
  const currency = settings.currency || DEFAULT_CURRENCY;
  const decimals = Math.min(2, Math.max(0, Number(settings.billDecimals ?? 2) || 0));
  const fmt = (n: number) => money(n, currency, decimals);
  const offPrem = type === "takeaway" || type === "delivery" || order?.type === "takeaway" || order?.type === "delivery";

  async function loadTables() {
    setTables(await api<DiningTable[]>("/api/tables"));
  }

  async function loadBase() {
    const [t, m, p] = await Promise.all([
      api<DiningTable[]>("/api/tables"),
      api<Category[]>("/api/menu"),
      api<Promotion[]>("/api/promotions"),
    ]);
    setTables(t);
    setMenu(m);
    setPromos(p.filter((x) => x.active));
  }

  async function openOrder(id = tableId, orderType = type) {
    const created = await api<Order>("/api/orders", {
      method: "POST",
      body: JSON.stringify({ tableId: id || undefined, type: orderType || (id ? "dine_in" : "takeaway") }),
    });
    setOrder(created);
    setPaid(null);
    setDiscountType(created.discountType);
    setDiscountValue(String(created.discountValue));
    setPromoId(created.promotionId || "");
    setGuestName(created.customerName || "");
    setGuestPhone(created.customerPhone || "");
    setGuestAddress(created.deliveryAddress || "");
  }

  useEffect(() => {
    void loadBase();
  }, []);

  useEffect(() => {
    if (existingId) {
      void api<Order>(`/api/orders/${existingId}`).then((row) => {
        setOrder(row);
        setPaid(null);
        setDiscountType(row.discountType);
        setDiscountValue(String(row.discountValue));
        setPromoId(row.promotionId || "");
        setGuestName(row.customerName || "");
        setGuestPhone(row.customerPhone || "");
        setGuestAddress(row.deliveryAddress || "");
      });
      return;
    }
    if (tableId || type === "takeaway" || type === "delivery") void openOrder();
    else setOrder(null);
  }, [tableId, type, existingId]);

  useEffect(() => {
    const socket = getSocket();
    const onOrder = (next: Order) => {
      setOrder((prev) => (prev && next.id === prev.id ? next : prev));
    };
    const refresh = () => void loadTables();
    socket.on("order:updated", onOrder);
    socket.on("table:updated", refresh);
    socket.on("pos:qr-order", refresh);
    return () => {
      socket.off("order:updated", onOrder);
      socket.off("table:updated", refresh);
      socket.off("pos:qr-order", refresh);
    };
  }, []);

  const items = useMemo(() => {
    const all = menu.flatMap((c) => c.items.map((i) => ({ ...i, categoryName: c.name })));
    const byCat = categoryId === "all" ? all : all.filter((i) => i.categoryId === categoryId);
    const q = query.trim().toLowerCase();
    if (!q) return byCat;
    return byCat.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        i.categoryName.toLowerCase().includes(q)
    );
  }, [menu, categoryId, query]);
  const activeCategory = menu.find((c) => c.id === categoryId);

  const pendingGuest = order?.items.filter((i) => i.status === "pending") || [];
  const ticketItems = useMemo(() => {
    if (!order) return [];
    return [...order.items].sort((a, b) => Number(isServedItem(a.status)) - Number(isServedItem(b.status)));
  }, [order]);
  const ticketPeople = useMemo(() => (order ? personBills(ticketItems, order) : []), [order, ticketItems]);
  const splitDiners = ticketPeople.length > 1 || (ticketPeople.length === 1 && ticketPeople[0].label !== "Shared");
  const dinerNames = useMemo(() => {
    const names = [...new Set((order?.items || []).map((i) => String(i.diner || "").trim()).filter(Boolean))];
    return names.sort((a, b) => a.localeCompare(b));
  }, [order]);
  const tableAlerts = alerts.filter((a) => a.tableId && a.tableId !== tableId);

  function selectTable(id: string) {
    if (!id) navigate("/pos?type=takeaway");
    else navigate(`/pos?table=${id}`);
  }

  function selectOffPrem(kind: "takeaway" | "delivery") {
    navigate(`/pos?type=${kind}`);
  }

  async function addItem(menuItemId: string) {
    if (!order || ["completed", "cancelled"].includes(order.status)) return;
    const next = await api<Order>(`/api/orders/${order.id}/items`, {
      method: "POST",
      body: JSON.stringify({ menuItemId, notes: note, diner }),
    });
    setOrder(next);
    setNote("");
  }

  async function setQty(itemId: string, qty: number) {
    if (!order) return;
    const next = await api<Order>(`/api/orders/${order.id}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ qty }),
    });
    setOrder(next);
  }

  async function setItemDiner(itemId: string, nextDiner: string) {
    if (!order) return;
    const next = await api<Order>(`/api/orders/${order.id}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ diner: nextDiner }),
    });
    setOrder(next);
  }

  async function markServed(itemId: string) {
    if (!order) return;
    const next = await api<Order>(`/api/orders/${order.id}/item-status`, {
      method: "POST",
      body: JSON.stringify({ itemIds: [itemId], status: "served" }),
    });
    setOrder(next);
  }

  async function saveGuest() {
    if (!order) return;
    const next = await api<Order>(`/api/orders/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        customerName: guestName,
        customerPhone: guestPhone,
        deliveryAddress: guestAddress,
        customerNote: order.customerNote,
      }),
    });
    setOrder(next);
  }

  async function applyPricing() {
    if (!order) return;
    const next = await api<Order>(`/api/orders/${order.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        discountType,
        discountValue: Number(discountValue),
        promotionId: discountType === "promotion" ? promoId : null,
        customerNote: order.customerNote,
      }),
    });
    setOrder(next);
    toast("Pricing updated");
  }

  async function sendKitchen() {
    if (!order) return;
    if (order.type === "delivery" && !guestAddress.trim()) {
      toast("Add a delivery address first", "err");
      return;
    }
    await run(`kitchen:${order.id}`, "Sending to kitchen", async () => {
      await saveGuest();
      const data = await api<{ order: Order; print: { status: string }; content: string }>(
        `/api/orders/${order.id}/send-kitchen`,
        { method: "POST" }
      );
      setOrder(data.order);
      alerts.filter((a) => a.orderId === order.id).forEach((a) => dismiss(a.id));
      if (data.content && data.print?.status !== "printed") {
        void printSlip(`Kitchen #${data.order.orderNo}`, data.content);
      }
      toast(data.print?.status === "printed" ? "Sent to kitchen · slip printed" : "Sent to kitchen", "info");
    });
  }

  async function printBill() {
    if (!order) return;
    await run(`bill:${order.id}`, "Printing bill", async () => {
      const data = await api<{ order: Order; print: { status: string }; content: string }>(`/api/orders/${order.id}/bill`, {
        method: "POST",
      });
      setOrder(data.order);
      if (data.print?.status !== "printed") void printSlip(`Bill #${data.order.orderNo}`, data.content);
      toast(data.print?.status === "printed" ? "Bill sent to slip printer" : "Bill slip ready to print");
    });
  }

  async function pay() {
    if (!order) return;
    const payments = payLines
      .filter((line) => Number(line.amount) > 0)
      .map((line) => ({ method: line.method, amount: Number(line.amount) }));
    const assigned = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    if (assigned !== Math.round(order.total * 100) / 100) {
      toast("Split amounts must equal the bill", "err");
      return;
    }
    const cashAmt = payments.find((p) => p.method === "cash")?.amount || 0;
    const paidAmount = cashAmt ? Number(tender || cashAmt) : order.total;
    await run(`pay:${order.id}`, "Printing receipt", async () => {
      const data = await api<{ order: Order; print: { status: string }; content?: string }>(`/api/orders/${order.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ payments, paidAmount }),
      });
      setPaid(data.order);
      setOrder(data.order);
      setPayOpen(false);
      void loadTables();
      if (data.content && data.print?.status !== "printed") {
        void printSlip(`Receipt #${data.order.orderNo}`, data.content);
      }
      toast(offPrem ? "Paid · check Pickup board" : "Paid · table is free");
    });
  }

  const table = tables.find((t) => t.id === (order?.tableId || tableId));
  const locked = !order || ["completed", "cancelled"].includes(order.status);
  const step = !order ? 0 : pendingGuest.length ? 1 : order.status === "open" ? 1 : 2;

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:h-[calc(100dvh-7.25rem)]">
      <div className="grid shrink-0 grid-cols-3 rounded-[24px] border border-white/8 bg-ink-900 p-1">
        <button
          type="button"
          onClick={() => setPosTab("tables")}
          className={`flex items-center justify-center gap-2 rounded-[20px] py-2.5 text-sm ${
            posTab === "tables" ? "bg-gold-500 text-ink-950" : "text-cream-100/55"
          }`}
        >
          <Table2 size={16} />
          Tables
        </button>
        <button
          type="button"
          onClick={() => setPosTab("check")}
          className={`relative flex items-center justify-center gap-2 rounded-[20px] py-2.5 text-sm ${
            posTab === "check" ? "bg-gold-500 text-ink-950" : "text-cream-100/55"
          }`}
        >
          <Receipt size={16} />
          Check
          {order?.items.length ? (
            <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${posTab === "check" ? "bg-ink-950/15" : "bg-gold-500/20 text-gold-400"}`}>
              {order.items.reduce((n, i) => n + i.qty, 0)}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setPosTab("bill")}
          className={`relative flex items-center justify-center gap-2 rounded-[20px] py-2.5 text-sm ${
            posTab === "bill" ? "bg-gold-500 text-ink-950" : "text-cream-100/55"
          }`}
        >
          <Banknote size={16} />
          Bill
          {order?.items.length ? (
            <span className={`hidden max-w-[4.5rem] truncate rounded-full px-1.5 text-[11px] tabular-nums sm:inline ${posTab === "bill" ? "bg-ink-950/15" : "bg-gold-500/20 text-gold-400"}`}>
              {fmt(order.total)}
            </span>
          ) : null}
        </button>
      </div>
      {posTab === "tables" && (
      <section className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-white/8 bg-ink-900">
        <div className="border-b border-white/5 p-3">
          <div className="mb-2 flex flex-col gap-1 px-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[11px] tracking-[0.16em] text-sage-400 uppercase">Tables</div>
            <div className="flex gap-3 text-[11px] text-cream-100/45">
              <span className="text-sage-400">Free</span>
              <span className="text-gold-400">Seated</span>
              <span className="text-sky-300">Guest order</span>
            </div>
          </div>
            <div className="flex gap-2 overflow-auto pb-1">
            <TableChip
              label="Takeaway"
              hint="pickup"
              active={!tableId && type === "takeaway"}
              tone="neutral"
              onClick={() => selectOffPrem("takeaway")}
            />
            <TableChip
              label="Delivery"
              hint="drop-off"
              active={!tableId && type === "delivery"}
              tone="guest"
              onClick={() => selectOffPrem("delivery")}
            />
            {tables.map((t) => {
              const open = t.orders?.[0];
              const guest = Boolean(open?.type === "qr" && open.items?.some((i) => i.status === "pending"));
              const tone = guest ? "guest" : t.status === "occupied" || t.status === "billing" ? "seated" : "free";
              return (
                <TableChip
                  key={t.id}
                  label={`T${t.number}`}
                  hint={guest ? "NEW" : t.status === "available" ? "free" : "seated"}
                  active={tableId === t.id}
                  tone={tone}
                  onClick={() => selectTable(t.id)}
                />
              );
            })}
          </div>
        </div>
        {tableAlerts.length > 0 && (
          <div className="flex gap-2 overflow-auto border-b border-sky-400/20 bg-sky-400/8 px-3 py-2">
            {tableAlerts.map((a) => (
              <button
                key={a.id}
                onClick={() => selectTable(a.tableId)}
                className="rounded-full bg-sky-400 px-3 py-1 text-xs font-medium text-ink-950"
              >
                Guest · T{a.tableNumber} · {a.items.reduce((n, i) => n + i.qty, 0)} items
              </button>
            ))}
          </div>
        )}
        {pendingGuest.length > 0 && order && (
          <div className="flex flex-col items-start gap-2 border-b border-sky-400/20 bg-sky-400/10 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span className="text-sky-300">
              Guest added {pendingGuest.reduce((n, i) => n + i.qty, 0)} item{pendingGuest.length === 1 ? "" : "s"} — send to kitchen
            </span>
            <button
              onClick={() => void sendKitchen()}
              disabled={busy(`kitchen:${order.id}`)}
              className="rounded-full bg-sky-400 px-3 py-1 text-xs font-semibold text-ink-950 disabled:opacity-50"
            >
              {busy(`kitchen:${order.id}`) ? "Sending…" : "Send now"}
            </button>
          </div>
        )}
        <div className="space-y-2 border-b border-white/5 px-3 py-2">
          <label className="relative block">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sage-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search dishes, SKU, or category"
              className="w-full rounded-2xl bg-ink-800 py-2.5 pr-9 pl-9 text-sm outline-none placeholder:text-cream-100/35"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-sage-400 hover:text-cream-50"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </label>
          <div className="flex gap-2 overflow-auto pb-0.5">
            <Chip active={categoryId === "all"} onClick={() => setCategoryId("all")}>
              All
            </Chip>
            {menu.map((c) => (
              <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
          {order && (
            <div className="px-1">
              <DinerPicker value={diner} names={dinerNames} disabled={locked} onChange={setDiner} />
              {diner.trim() ? (
                <div className="mt-1 px-0.5 text-[11px] text-gold-400">Next dishes go on {diner.trim()}</div>
              ) : null}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note for the next item"
                className="mt-2 w-full rounded-xl bg-ink-800 px-3 py-2 text-sm outline-none placeholder:text-cream-100/35"
                disabled={locked}
              />
            </div>
          )}
          <div className="px-1 text-[11px] text-cream-100/40">
            {items.length} dish{items.length === 1 ? "" : "es"}
            {activeCategory ? ` in ${activeCategory.name}` : ""}
            {query.trim() ? ` matching “${query.trim()}”` : ""}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!order && (
            <div className="mb-3 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-cream-100/50">
              Pick a table, Takeaway, or Delivery to start a ticket.
            </div>
          )}
          {items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-cream-100/50">
              No dishes match{query.trim() ? ` “${query.trim()}”` : ""}
              {activeCategory ? ` in ${activeCategory.name}` : ""}.
              {categoryId !== "all" && (
                <button
                  type="button"
                  onClick={() => setCategoryId("all")}
                  className="mt-3 block w-full text-gold-400"
                >
                  Search all categories
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
              <button
                key={item.id}
                disabled={!item.available || locked}
                onClick={() => void addItem(item.id)}
                className="rounded-[22px] border border-white/8 bg-ink-800 p-2.5 text-left transition hover:border-gold-400/50 hover:bg-ink-700 disabled:opacity-35"
              >
                <DishPhoto item={item} className="mb-2 aspect-[4/3] w-full rounded-2xl" />
                <div className="px-1 text-[10px] tracking-wide text-sage-400 uppercase">{item.categoryName}</div>
                <div className="flex items-start justify-between gap-2 px-1">
                  <div className="min-w-0 font-medium leading-snug">{item.name}</div>
                  <span className="shrink-0 text-sm text-gold-400">{fmt(item.price)}</span>
                </div>
                <div className="mt-0.5 line-clamp-2 px-1 text-xs text-cream-100/45">{item.description}</div>
              </button>
            ))}
          </div>
        </div>
      </section>
      )}

      {posTab === "check" && (
      <aside className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-white/8 bg-ink-900">
        <div className="border-b border-white/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] tracking-[0.16em] text-sage-400 uppercase">
                {table
                  ? `Table ${table.number} · ${table.name}`
                  : order?.type === "delivery" || type === "delivery"
                    ? "Delivery"
                    : order?.type === "takeaway" || type === "takeaway"
                      ? "Takeaway pickup"
                      : "No ticket"}
              </div>
              <div className="display text-2xl leading-none sm:text-3xl">#{order?.orderNo || "—"}</div>
            </div>
            {order && <StatusPill status={order.status} guest={pendingGuest.length > 0} items={order.items} />}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[11px]">
            {["Add", "Kitchen", "Pay"].map((label, i) => (
              <div
                key={label}
                className={`rounded-full py-1 ${i < step ? "bg-gold-500/20 text-gold-400" : "bg-white/5 text-cream-100/35"}`}
              >
                {i + 1} {label}
              </div>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!order?.items.length && (
            <div className="px-2 py-10 text-center text-sm text-cream-100/40">Tap dishes to build the guest check.</div>
          )}
          {offPrem && order && (
            <div className="mb-3 space-y-2 rounded-2xl bg-ink-800 p-3">
              <div className="text-[11px] tracking-[0.16em] text-sky-300 uppercase">
                {order.type === "delivery" ? "Delivery details" : "Pickup guest"}
              </div>
              <input
                className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                placeholder="Guest name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onBlur={() => void saveGuest()}
              />
              <input
                className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                placeholder="Phone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                onBlur={() => void saveGuest()}
              />
              {order.type === "delivery" && (
                <textarea
                  className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                  rows={2}
                  placeholder="Delivery address"
                  value={guestAddress}
                  onChange={(e) => setGuestAddress(e.target.value)}
                  onBlur={() => void saveGuest()}
                />
              )}
            </div>
          )}
          {order && (
            <div className="mb-3">
              <DinerPicker value={diner} names={dinerNames} disabled={locked} onChange={setDiner} />
            </div>
          )}
          {ticketPeople.map((group) => (
            <div key={group.label} className={splitDiners ? "mb-3 rounded-[22px] bg-white/5 p-2" : undefined}>
              {splitDiners && (
                <div className="mb-2 flex items-baseline justify-between px-2 pt-1">
                  <div className="text-[11px] tracking-[0.16em] text-gold-400 uppercase">{group.label}</div>
                  <div className="text-xs text-cream-100/45">{group.items.reduce((n, i) => n + i.qty, 0)} item{group.items.reduce((n, i) => n + i.qty, 0) === 1 ? "" : "s"}</div>
                </div>
              )}
              {group.items.map((item, index) => (
                <div key={item.id}>
                  {!splitDiners && isServedItem(item.status) && (index === 0 || !isServedItem(group.items[index - 1]?.status)) && (
                    <div className="mt-3 mb-2 px-1 text-[11px] tracking-[0.16em] text-cream-100/35 uppercase">Served</div>
                  )}
                  <div
                    className={`mb-2 rounded-2xl p-3 ${
                      item.status === "pending"
                        ? "bg-sky-400/10 ring-1 ring-sky-400/30"
                        : item.status === "served"
                          ? "bg-ink-800/70 opacity-70"
                          : "bg-ink-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-cream-100/45">
                          {fmt(item.price)}
                          {item.status === "pending" ? " · new" : ` · ${itemKitchenLabel(item.status)}`}
                          {item.notes ? ` · ${item.notes}` : ""}
                          {!splitDiners && item.diner ? ` · ${item.diner}` : ""}
                        </div>
                      </div>
                      {!locked && (
                        <button onClick={() => void setQty(item.id, 0)} className="text-rose-400">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    {!locked && (
                      <input
                        defaultValue={item.diner || ""}
                        key={`${item.id}-${item.diner || ""}`}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next !== String(item.diner || "").trim()) void setItemDiner(item.id, next);
                        }}
                        placeholder="Name (optional)"
                        className="mt-2 w-full rounded-lg bg-ink-900 px-2 py-1 text-[11px] outline-none placeholder:text-cream-100/30"
                      />
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <button disabled={locked || item.status === "served"} onClick={() => void setQty(item.id, item.qty - 1)} className="rounded-lg bg-white/5 p-1 disabled:opacity-35">
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center tabular-nums">{item.qty}</span>
                      <button disabled={locked || item.status === "served"} onClick={() => void setQty(item.id, item.qty + 1)} className="rounded-lg bg-white/5 p-1 disabled:opacity-35">
                        <Plus size={14} />
                      </button>
                      {canServeItem(item.status) && !locked && (
                        <button
                          onClick={() => void markServed(item.id)}
                          className="inline-flex items-center gap-1 rounded-full bg-gold-500/20 px-2.5 py-1 text-[11px] text-gold-400"
                        >
                          <Check size={12} />
                          Served
                        </button>
                      )}
                      <span className="ml-auto text-sm tabular-nums">{fmt(item.price * item.qty)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {splitDiners && (
                <div className="mt-1 mb-1 flex items-baseline justify-between rounded-2xl bg-gold-500/15 px-3 py-2">
                  <span className="text-sm">{group.label} total</span>
                  <span className="display text-xl leading-none">{fmt(group.total)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
      )}

      {posTab === "bill" && (
      <aside className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-white/8 bg-ink-900">
        <div className="border-b border-white/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] tracking-[0.16em] text-sage-400 uppercase">
                {table
                  ? `Table ${table.number} · ${table.name}`
                  : order?.type === "delivery" || type === "delivery"
                    ? "Delivery"
                    : order?.type === "takeaway" || type === "takeaway"
                      ? "Takeaway pickup"
                      : "No ticket"}
              </div>
              <div className="display text-2xl leading-none sm:text-3xl">#{order?.orderNo || "—"}</div>
            </div>
            {order && <StatusPill status={order.status} guest={pendingGuest.length > 0} items={order.items} />}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
          {!order?.items.length && (
            <div className="px-2 py-10 text-center text-cream-100/40">Add dishes on Tables, then open Bill to split and checkout.</div>
          )}
          {offPrem && order && (
            <div className="mb-3 space-y-2 rounded-2xl bg-ink-800 p-3">
              <div className="text-[11px] tracking-[0.16em] text-sky-300 uppercase">
                {order.type === "delivery" ? "Delivery details" : "Pickup guest"}
              </div>
              <input
                className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                placeholder="Guest name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onBlur={() => void saveGuest()}
              />
              <input
                className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                placeholder="Phone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                onBlur={() => void saveGuest()}
              />
              {order.type === "delivery" && (
                <textarea
                  className="w-full rounded-xl bg-ink-900 px-3 py-2 text-sm outline-none"
                  rows={2}
                  placeholder="Delivery address"
                  value={guestAddress}
                  onChange={(e) => setGuestAddress(e.target.value)}
                  onBlur={() => void saveGuest()}
                />
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="rounded-xl bg-ink-800 px-2 py-2" disabled={locked}>
              <option value="none">No discount</option>
              {can("discount") && <option value="percent">% off</option>}
              {can("discount") && <option value="fixed">฿ off</option>}
              <option value="promotion">Promotion</option>
            </select>
            {discountType === "promotion" ? (
              <select value={promoId} onChange={(e) => setPromoId(e.target.value)} className="rounded-xl bg-ink-800 px-2 py-2" disabled={locked}>
                <option value="">Select promo</option>
                {promos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="rounded-xl bg-ink-800 px-2 py-2"
                disabled={locked || discountType === "none"}
              />
            )}
          </div>
          <button disabled={locked} onClick={() => void applyPricing()} className="mt-2 w-full rounded-xl bg-white/5 py-2 disabled:opacity-40">
            Apply discount / promo
          </button>
          {splitDiners && (
            <div className="mt-3 rounded-2xl bg-gold-500/10 p-3">
              <div className="mb-1 text-[11px] tracking-[0.16em] text-gold-400 uppercase">Each person</div>
              {ticketPeople.map((group) => (
                <Row key={group.label} label={group.label} value={fmt(group.total)} />
              ))}
            </div>
          )}
          <div className="mt-3 space-y-1">
            <Row label="Subtotal" value={fmt(order?.subtotal || 0)} />
            {Boolean(order?.discountAmount) && <Row label="Discount" value={`-${fmt(order?.discountAmount || 0)}`} />}
            <Row label={`Tax ${order?.taxRate || 0}%`} value={fmt(order?.taxAmount || 0)} />
            {Boolean(order?.serviceAmount) && <Row label="Service" value={fmt(order?.serviceAmount || 0)} />}
            {Boolean(order?.roundAmount) && (
              <Row label={(order?.roundAmount || 0) > 0 ? "Round up" : "Round down"} value={fmt(order?.roundAmount || 0)} />
            )}
            <Row label="Due" value={fmt(order?.total || 0)} big />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-white/5 p-4">
          <button
            disabled={locked || !pendingGuest.length || busy(`kitchen:${order?.id}`)}
            onClick={() => void sendKitchen()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sage-500/20 py-2.5 text-sage-400 disabled:opacity-35"
          >
            <Send size={16} /> {busy(`kitchen:${order?.id}`) ? "Sending…" : "Kitchen"}
          </button>
          <button
            disabled={!order || busy(`bill:${order?.id}`)}
            onClick={() => void printBill()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/5 py-2.5 disabled:opacity-35"
          >
            <Printer size={16} /> {busy(`bill:${order?.id}`) ? "Printing…" : "Print bill"}
          </button>
          {can("checkout") && !locked && (
            <button
              disabled={!order?.items.length}
              onClick={() => {
                if (order?.type === "delivery" && !guestAddress.trim()) {
                  toast("Add a delivery address first", "err");
                  return;
                }
                setPayLines([{ method: "cash", amount: String(order.total) }]);
                setTender("");
                setPayOpen(true);
              }}
              className="col-span-2 rounded-2xl bg-gold-500 py-3 font-medium text-ink-950 disabled:opacity-40"
            >
              {offPrem ? "Checkout" : "Checkout · free table"}
            </button>
          )}
        </div>
      </aside>
      )}

      {payOpen && order && (
        <div className="fixed inset-0 z-[60] grid place-items-end bg-black/65 p-3 sm:place-items-center sm:p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-900 p-5 sm:p-6">
            <div className="text-xs tracking-[0.16em] text-sage-400 uppercase">Charge & clear table</div>
            <div className="display text-3xl">{fmt(order.total)}</div>
            {splitDiners && (
              <div className="mt-3 space-y-1 rounded-2xl bg-gold-500/10 p-3 text-sm">
                <div className="text-[11px] tracking-[0.16em] text-gold-400 uppercase">Each person</div>
                {ticketPeople.map((group) => (
                  <div key={group.label} className="flex justify-between">
                    <span>{group.label}</span>
                    <span className="tabular-nums">{fmt(group.total)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 grid grid-cols-3 gap-2">
              {["cash", "card", "qr"].map((m) => {
                const on = payLines.some((line) => line.method === m);
                return (
                  <button
                    key={m}
                    onClick={() => {
                      setPayLines((lines) => {
                        const has = lines.some((line) => line.method === m);
                        if (has) {
                          if (lines.length === 1) return lines;
                          const next = lines.filter((line) => line.method !== m);
                          if (next.length === 1) return [{ ...next[0], amount: String(order.total) }];
                          return next;
                        }
                        const used = lines.reduce((s, line) => s + Number(line.amount || 0), 0);
                        const remain = Math.max(Math.round((order.total - used) * 100) / 100, 0);
                        return [...lines, { method: m, amount: String(remain || 0) }];
                      });
                    }}
                    className={`rounded-2xl py-3 capitalize ${on ? "bg-gold-500 text-ink-950" : "bg-ink-800"}`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 space-y-2">
              {payLines.map((line, index) => (
                <label key={line.method} className="block text-sm">
                  <span className="capitalize text-cream-100/60">{line.method} amount</span>
                  <input
                    className="mt-1 w-full rounded-2xl bg-ink-800 px-4 py-3 outline-none"
                    value={line.amount}
                    onChange={(e) => {
                      const amount = e.target.value;
                      setPayLines((lines) => lines.map((row, i) => (i === index ? { ...row, amount } : row)));
                    }}
                  />
                </label>
              ))}
            </div>
            {payLines.some((line) => line.method === "cash") && (
              <input
                className="mt-3 w-full rounded-2xl bg-ink-800 px-4 py-3 outline-none"
                placeholder="Cash tendered"
                value={tender}
                onChange={(e) => setTender(e.target.value)}
              />
            )}
            <div className="mt-2 text-sm text-sage-400">
              Remaining{" "}
              {fmt(
                Math.round(
                  (order.total - payLines.reduce((s, line) => s + Number(line.amount || 0), 0)) * 100
                ) / 100
              )}
              {payLines.some((line) => line.method === "cash")
                ? ` · Change ${fmt(
                    Math.max(
                      Number(tender || payLines.find((l) => l.method === "cash")?.amount || 0) -
                        Number(payLines.find((l) => l.method === "cash")?.amount || 0),
                      0
                    )
                  )}`
                : ""}
            </div>
            <p className="mt-2 text-xs text-cream-100/45">
              {offPrem
                ? "Prints a receipt. The order stays on Pickup & delivery until collected or delivered."
                : "Prints a receipt, opens the cash drawer on cash, and sets the table back to free."}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setPayOpen(false)} className="flex-1 rounded-2xl bg-white/5 py-3">
                Back
              </button>
              <button
                disabled={busy(`pay:${order.id}`)}
                onClick={() => void pay()}
                className="flex-1 rounded-2xl bg-gold-500 py-3 font-medium text-ink-950 disabled:opacity-40"
              >
                <Printer size={16} className="mr-1 inline" /> {busy(`pay:${order.id}`) ? "Paying…" : "Pay"}
              </button>
            </div>
          </div>
        </div>
      )}

      {paid && (paid.status === "completed" || paid.status === "paid") && (
        <div className="fixed inset-0 z-[60] grid place-items-end bg-black/65 p-3 sm:place-items-center sm:p-4">
          <div className="w-full max-w-sm rounded-3xl border border-sage-400/30 bg-ink-900 p-5 text-center sm:p-6">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-sage-500/20 text-sage-400">
              <Check size={22} />
            </div>
            <div className="display mt-3 text-2xl">
              {paid.type === "takeaway" || paid.type === "delivery" ? "Paid · check Pickup" : "Paid · table free"}
            </div>
            <p className="mt-1 text-sm text-cream-100/60">
              #{paid.orderNo} · {fmt(paid.total)}
              {paid.changeAmount ? ` · change ${fmt(paid.changeAmount)}` : ""}
              {paid.paymentMethod ? ` · ${paid.paymentMethod.replace(/\+/g, " + ")}` : ""}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setPaid(null);
                  setOrder(null);
                  navigate(paid.type === "takeaway" || paid.type === "delivery" ? "/dispatch" : "/tables");
                }}
                className="rounded-2xl bg-white/5 py-3"
              >
                {paid.type === "takeaway" || paid.type === "delivery" ? "Pickup board" : "Floor"}
              </button>
              <button
                onClick={() => {
                  setPaid(null);
                  setOrder(null);
                  navigate("/pos");
                }}
                className="rounded-2xl bg-gold-500 py-3 text-ink-950"
              >
                New ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableChip({
  label,
  hint,
  active,
  tone,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  tone: "free" | "seated" | "guest" | "neutral";
  onClick: () => void;
}) {
  const tones = {
    free: "border-sage-400/30 text-sage-400",
    seated: "border-gold-400/40 text-gold-400",
    guest: "pulse-ring border-sky-400/50 bg-sky-400/15 text-sky-300",
    neutral: "border-white/10 text-cream-100/70",
  };
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-2xl border px-3 py-2 text-left ${tones[tone]} ${active ? "bg-white/10 ring-1 ring-gold-400/60" : ""}`}
    >
      <div className="text-sm font-medium">{label}</div>
      {hint && <div className="text-[10px] uppercase tracking-wide opacity-80">{hint}</div>}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap ${active ? "bg-gold-500 text-ink-950" : "bg-ink-800 text-cream-100/70"}`}
    >
      {children}
    </button>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`flex justify-between ${big ? "display text-xl text-gold-400" : "text-cream-100/65"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function allItemsServed(items?: { status: string }[]) {
  const live = (items || []).filter((i) => i.status !== "cancelled");
  return live.length > 0 && live.every((i) => i.status === "served");
}

function StatusPill({ status, guest, items }: { status: string; guest: boolean; items?: { status: string }[] }) {
  const served = allItemsServed(items);
  const label = guest
    ? "Guest order"
    : served
      ? "Served"
      : status === "in_kitchen"
        ? "In kitchen"
        : status === "completed"
          ? "Paid"
          : status;
  const cls = guest
    ? "bg-sky-400/15 text-sky-300"
    : served || status === "completed"
      ? "bg-sage-500/15 text-sage-400"
      : "bg-gold-500/15 text-gold-400";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] tracking-wide uppercase ${cls}`}>{label}</span>;
}
